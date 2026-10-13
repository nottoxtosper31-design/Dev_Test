# DevNight — Real-time Web Control for GTA San Andreas

เว็บแผงควบคุมโทนดำชื่อ **DevNight** สำหรับปรับค่าเกม *Grand Theft Auto: San Andreas* (`gta_sa.exe`)
แบบเรียลไทม์ผ่านเบราว์เซอร์ — ตรวจพบ process/memory ของเกมก่อนจึงจะปลดล็อกให้ปรับค่าได้

> ใช้กับ **GTA San Andreas v1.0 (US)** และโหมด **คนเดียวเท่านั้น**

## การแบ่งงาน (คู่กับ FastMelee.asi)

| ส่วน | หน้าที่ | วิธี / Address |
|---|---|---|
| **FastMelee.asi** (แยกต่างหาก) | **ฟันประชิดไวขึ้น** | code hook ในเกม (พิสูจน์แล้วได้ผล) — วางในโฟลเดอร์ GTA SA + Ultimate ASI Loader |
| **Speed Run** (เว็บ) | เร่งอนิเมชันเดิน/วิ่ง (ตัวละครวิ่งเร็วขึ้นจริง) | 2 กลไก (เลือกโหมดได้ · ค่าเริ่มต้น `anim`): **anim** = เร่งความเร็วอนิเมชันเดิน/วิ่ง — `CAnimBlendAssociation::m_Speed` @ `+0x24` ของ assoc ที่ `m_nAnimId` = WALK(`0`)/RUN(`1`)/SPRINT(`2`) · **vel** = ตัวคูณความเร็วเดิม `CPhysical::m_vecMoveSpeed` @ `ped+0x44` |
| **Melee Speed** (เว็บ) | เร่งฟันประชิด | 2 กลไก (เลือกโหมดได้ · ค่าเริ่มต้น `anim`): **timing** = ย่อเวลาตี/ต่อคอมโบจริงจาก `data/melee.dat` — `CTaskSimpleFight::m_aComboData` @ `0xC170D0` (`m_fHit[5]` @ `+0x08`, `m_fChain[5]` @ `+0x1C`) · **anim** = เร่งความเร็วการเล่นอนิเมชันฟัน — `CAnimBlendAssociation::m_Speed` @ `+0x24` ของ assoc ที่เป็นท่า melee |
| **Rotation** (เว็บ) | การหมุน/เลี้ยว | `CPed::m_fHeadingChangeRate` @ `0x560` — ใช้ได้จริง ✅ |
| **Aimbot** (เว็บ) | ล็อกเป้าไปที่ **ผู้เล่นจริง** ที่ใกล้สุด | ped pool `0xB74490` + กรองด้วย **ped type (0x598)** เอาเฉพาะผู้เล่น (type 0-3) ไม่เอา NPC · **4 โหมด**: **Mode 1 `lock`** = เขียน `CPed::m_pTargetedObject` @ `ped+0x71C` (+ `m_p3rdPersonMouseTarget` @ `0x79C`) ให้ **เกมล็อกเป้าและตามตัวเป้าเอง** · **Mode 2 `soft`** = ยกตรรกะ source HeadShotAimBot: **เขียนมุมกล้อง `0xB6F248`/`0xB6F258`** ไปที่เป้า แต่ไล่มุมทีละส่วนต่อ tick + จำกัดความเร็ว → **ไม่ดูด/ไม่กระชาก** · **Mode 2+ `snap`** = เขียนมุมกล้องเต็มทุก tick (พฤติกรรมเป๊ะของ source) · สำรอง **`mouse`** = คำนวณ yaw/pitch จาก **camera world matrix `0xB6F9E4`** + `mouse_event` (ตามเต็ม ไม่จำกัดความเร็ว) — ขณะกดคลิกขวา · ล็อกแบบ **sticky** |

> **หมายเหตุ (สำคัญ):** แก้บั๊กแล้ว — เดิม Melee Speed เขียน `CWeaponInfo::m_fAnimLoopEnd`/`m_fBreakoutTime` (`0xC8AAB8`)
> แต่อาวุธ **melee ไม่มีคอลัมน์ animLoop/breakout ใน weapon.dat** (ค่าจึงเป็น `0`) → การหารด้วยตัวคูณจึง **ไม่มีผลอะไรเลย**
> เวอร์ชันนี้ใช้ค่าจริง: **เวลาตี (`m_fHit`) และเวลาต่อคอมโบ (`m_fChain`) ของ `melee.dat`** (ข้อมูล static ที่เกมอ่านทุกครั้งที่ฟัน)
> และ/หรือ **เร่งความเร็วการเล่นอนิเมชันฟัน** ผ่าน `CAnimBlendAssociation::m_Speed` (ค่าที่เกมใช้คำนวณความเร็วอนิเมชันจริง)

Offset โครงสร้าง `CPed` ทั้งหมด (`m_fHealth=0x540`, `m_fArmour=0x548`, `m_fHeadingCurrent=0x558`,
`m_fMoveAnim=0x564`, `m_nWeaponShootingRate=0x719`, `m_nAttackTimer=0x74C`, …) มาจาก plugin-sdk ของ GTA SA
จึงแก้/สลับได้ตลอดเวลาในส่วน **Advanced** ของแต่ละค่าบนเว็บ แล้วกด *Apply offset*

## หลักการ

เบราว์เซอร์เองแตะหน่วยความจำเกมโดยตรงไม่ได้ โครงระบบจึงเป็นดังนี้:

```
เบราว์เซอร์ (UI ดำ DevNight)  --HTTP-->  server.js (Node, รันบนเครื่อง)
                                              |
                                              +-- koffi FFI --> Windows API
                                                  OpenProcess / ReadProcessMemory / WriteProcessMemory
                                              |
                                              +-- keeper loop เขียนค่าซ้ำทุก 50 มิลลิวินาที (คงค่าไว้เรียลไทม์)
```

- **ตรวจเกม**: `tasklist` หา PID ของ `gta_sa.exe` แล้ว `OpenProcess`
- **กันค่าถูกเกมเขียนทับ**: background loop เขียนค่าที่เปิดใช้งานซ้ำทุก 50 มิลลิวินาที
- **ดึงค่ากลับ**: ปิดค่า (toggle off) จะเขียนค่าเดิมที่อ่านไว้ตอนเปิด กลับคืน

## ติดตั้ง & รัน

```bash
npm install          # ติดตั้ง express + koffi (koffi เป็น prebuilt ไม่ต้อง compile)
npm start            # = node server.js
```

แล้วเปิด **http://localhost:3000** (server จะพยายามเปิดเบราว์เซอร์ให้อัตโนมัติ)

### ⚠️ ต้องรันแบบ Administrator (สำคัญมาก)

เกม GTA SA / SA-MP มักถูกรันด้วยสิทธิ์ **Administrator** (integrity สูง) ถ้า server รันแบบปกติ
จะ `OpenProcess` เกมไม่ได้เลย (error 5 = Access denied) → ทุกฟีเจอร์รวมถึง Aimbot จะ *เงียบ ไม่ทำอะไร*

- เวอร์ชันนี้จะ **ตรวจจับและเปิดตัวเองใหม่แบบ Administrator อัตโนมัติ** (มีหน้าต่าง UAC เด้งขึ้น — กด **Yes**)
  ถ้าไม่อยากให้เด้งอัตโนมัติ ตั้ง env `DEVNIGHT_NO_ELEVATE=1`
- หรือดับเบิลคลิก **`start-admin.cmd`** (ในโฟลเดอร์โปรแกรม) เพื่อเปิดแบบ Administrator ตรง ๆ
- ถ้าเปิดผ่านเว็บแล้วเห็นแบนเนอร์เตือนสีเหลือง = ยังไม่ได้รันแบบ Administrator ให้ปิดแล้วเปิดด้วย `start-admin.cmd`

> ถ้า `OpenProcess` ขึ้น *Access denied* ให้รันเทอร์มินัลด้วยสิทธิ์ **Administrator**
> (จำเป็นเฉพาะตอนเกมรันด้วยสิทธิ์สูง)

## วิธีใช้งานบนเว็บ

1. **เข้าเกม** (`gta_sa.exe`) ให้เรียบร้อย
2. กดปุ่ม **“ตรวจหาตัวเกม”** ที่มุมขวาบน → ระบบสแกน process + แนบ memory
3. ถ้าสำเร็จ แผงควบคุมจะปลดล็อก (pill เป็นสีเขียว + แสดง PID)
4. ลากสไลเดอร์ **Melee Speed / Speed Run / Rotation** → ค่าจะถูกส่งและเขียนลงเกมทันทีแบบเรียลไทม์
   - **Melee Speed**: เลือก **โหมด** ได้ที่การ์ด — `anim` (ค่าเริ่มต้น · เร่งอนิเมชันฟัน — ท่าฟันเร็วขึ้นจริง และตีโดนเร็วขึ้นตามสัดส่วน), `timing` (เฉพาะต่อคอมโบไวขึ้น — ท่าฟันยังเล่นความเร็วปกติ), `both` (รวมสองอย่าง · เร็วสุด เพราะสองกลไก **คูณกัน**) · ค่า = ตัวคูณ (1 = ปกติ)
   - **Speed Run**: เลือก **โหมด** ได้ที่การ์ด — `anim` (ค่าเริ่มต้น · เร่งอนิเมชันเดิน/วิ่ง — **ขาและระยะที่วิ่งเร็วขึ้นพร้อมกัน** ไม่สไลด์ เพราะเกมดึงความเร็วการเคลื่อนที่จากอนิเมชันเอง), `vel` (เร่งความเร็วเคลื่อนที่อย่างเดียว — แบบเดิม), `both` (รวมสองอย่าง · เร็วสุด) · ค่า = ตัวคูณ (1 = ปกติ) · ทดสอบตอน**วิ่ง**ในเกม (ตอนยืน/idle จะไม่เห็นผล)
   - **Aimbot**: เปิดสวิตช์ แล้วตั้ง *ระยะล็อก (ม.)* ที่สไลเดอร์ → ขณะ**กดคลิกขวา**ในเกม ระบบหาผู้เล่น (player) ที่ใกล้ที่สุดในระยะ แล้วล็อกเป้าให้ · เลือก **โหมดการล็อกเป้า** ได้ที่การ์ด (2 โหมด + 1 ต่อยอด + 1 สำรอง):
     - **Mode 1 — ล็อกเต็ม ตามตัวเป้า (แบบเดิม)**: เขียนบอกเกมว่ากำลังเล็งผู้เล่นคนนี้ (เขียน `CPed::m_pTargetedObject` @ `ped+0x71C` และ `CPlayerPed::m_p3rdPersonMouseTarget` @ `ped+0x79C`) แล้ว **เกมเป็นคนล็อก/เล็งให้เอง** — เป้าวิ่งไปทางไหน **การเล็งจะตามตัวเป้าไปด้วย** (เรายังไม่ฉีดเมาส์เอง)
     - **Mode 2 — ล็อกนุ่ม ตาม source (`soft` · ใหม่ · ไม่ตามเท่า Mode 1)**: ยกตรรกะของ **HeadShotAimBot** (source ต้นแบบใน `..\aimbot`) มาใช้ — DevNight **หันกล้องเอง** ด้วยการเขียน **มุมกล้อง `0xB6F248` (X) / `0xB6F258` (Z)** ไปที่ตัวเป้า (สูตรเดียวกับ source: `xAngle = pitchRaw - xOff`, `zAngle = -(yawRaw - π/2 - zOff)` พร้อมแก้ FOV/เส้นเล็งจาก `0x8D5038` / `0xB6EC10` / `0xB6EC14` / `0xC3EFA4`) แต่ **ไล่มุมแค่ `AIM_SOFT_GAIN = 0.3` ของมุมที่เหลือต่อ tick และจำกัดไม่เกิน `AIM_SOFT_MAX_DEG = 3°` ต่อ tick** → กล้องค่อย ๆ ไถลเข้าหาเป้า ไม่กระชาก/ไม่ดูดติดเป้าแบบ Mode 1 · เป้าวิ่ง = กล้องตามแบบตามหลังอยู่เล็กน้อย · **ไม่ฉีดเมาส์**
     - **Mode 2+ — ตาม source เป๊ะ (`snap`)**: กลไกเดียวกับ Mode 2 แต่ **เขียนมุมกล้องเต็มทุก tick** (ไม่ไล่ทีละส่วน ไม่จำกัดความเร็ว) = พฤติกรรมเป๊ะของ source ต้นแบบ (สแนป/ตามแน่น)
     - **โหมดสำรอง `mouse`**: หันกล้องด้วยการฉีดเมาส์ (camera world matrix `0xB6F9E4` + `mouse_event`) **ทุก tick ด้วย `AIM_GAIN = 0.6` และไม่จำกัดความเร็วการหมุน** — ตามตัวเป้าแบบแน่น (ใช้เมื่อการเขียนมุมกล้อง/Mode 1 ไม่ทำงานกับ build นี้)
     - สรุป: `Mode 1` = ตามตัวเป้าเต็ม (เกมตามให้เอง) · `Mode 2` = ล็อกนุ่มด้วยการเขียนมุมกล้อง (ไล่ทีละส่วน) · `Mode 2+` = เขียนมุมกล้องเต็มทุก tick ตาม source เป๊ะ · `mouse` = ตามเต็มด้วยการฉีดเมาส์ · **ทุกโหมดยังล็อกเฉพาะผู้เล่นจริง**
     - หมายเหตุ Mode 2/2+: เพราะแยกโปรเซส (Node 64-bit) เรียก **`CPed::GetBonePosition`** ในเกมไม่ได้ จุดเล็งจึงใช้ **ped origin + `AIM_BONE_H = 0.8 ม.` (≈ BONE_HEAD)** แทน · และการเลือกเป้าใช้ **ผู้เล่นจริงที่ใกล้สุด** (ตามสเปกเดิม) ไม่ใช่การยิงเส้นจากปากกระบอกแบบ source
     - ค่าที่ใช้จริงโชว์ในแผง **Aimbot Debug**: แถว *มุมกล้องปัจจุบัน* / *มุมที่ aimbot จะเขียน* / *มุมที่ต้องหันอีก* (Mode 2/2+) และ *วิธีไล่มุมกล้อง* (soft: ไล่ `0.3`/tick · จำกัด `3°` · snap: เขียนเต็มทุก tick)
     - **ล็อกเฉพาะผู้เล่นจริง (ไม่เอา NPC)**: เปิดไว้เป็นค่าเริ่มต้น — ระบบจะกรอง ped ที่ `ped type` (0x598) ไม่ใช่ผู้เล่น (type 0-3) ออกทั้งหมด เหลือแต่ผู้เล่นจริง (ใน SA-MP ผู้เล่นจะมาเป็น `PLAYER_NETWORK` = type 2) · เปิด/ปิดได้จากช่องติ๊กในแผง **Aimbot Debug**
     - ล็อกแบบ **sticky**: เมื่อล็อกเป้าแล้วจะเกาะเป้าเดิมต่อไป จนกว่าจะ**ปล่อยคลิกขวา** เป้าตาย หรือเป้าหนีออกนอกระยะ
     - ระบบจะทำงานเฉพาะตอนหน้าต่าง**เกม**เป็นหน้าต่างที่กำลังใช้งาน (foreground) เท่านั้น — ถ้าสลับไปหน้าเว็บ จะปล่อยล็อกทันที
5. ต้องการแก้ offset ระหว่างเทส → เปิด **Advanced** ของค่า แล้วแก้ `Base / Pointer offsets / Value offset / Type` แล้วกด **Apply offset**
6. สลับสวิตช์ของแต่ละค่าเพื่อ **ปิด** (จะคืนค่าเดิมกลับไป)

## แก้ปัญหา Aimbot (กดคลิกขวาแล้วไม่ล็อก)

กดปุ่ม **Aimbot Debug** ที่มุมขวาบน เพื่อดูทุกขั้นตอนแบบเรียลไทม์ แล้วทำตามนี้:

1. **รัน server แบบ Administrator** (ดูหัวข้อด้านบน) — ถ้าเกมรัน elevated แต่ server ไม่ได้ เกมจะแนบไม่ได้เลย
   (แถว `แนบเกม` = ไม่ และ `/api/detect` จะขึ้น *Access denied*) — ปิดแล้วเปิดด้วย `start-admin.cmd`
2. **ฮาร์ดรีเฟรชเบราว์เซอร์** (`Ctrl+F5`) — ไฟล์ `app.js` ถูกแคชไว้ได้
3. เปิด **สวิตช์ Aimbot** บนการ์ดให้เป็นสีเขียว (ถ้าไม่เปิด จะไม่ทำอะไรเลย)
4. เข้าเกม กด **คลิกขวาค้าง** แล้วดูแถวใน Aimbot Debug:
   - `แนบเกม` = ไม่ → ยังไม่แนบ process (ดูข้อ 1)
   - `รันแบบ Administrator` = ไม่ → ต้องรัน server ด้วยสิทธิ์ Administrator
   - `กดคลิกขวาค้างอยู่` = ไม่ → ระบบตรวจปุ่มไม่เจอ
   - `หน้าต่างเกมเป็น foreground` = ไม่ → ต้องคลิกให้เกมเป็นหน้าต่างหลัก (และอย่าต่ำสุด/hidden อยู่)
   - `เป้าใกล้สุด` = — → หา ped ไม่เจอ (ระยะสั้นไป / ยังไม่ spawn / stride ผิด — ดูแถว `ped stride`)
   - `เป้าใกล้สุด` ขึ้นชนิดเป็น NPC (เช่น CIVMALE/COP) → ตรวจว่า **ล็อกเฉพาะผู้เล่นจริง** เปิดอยู่ (ดูแถวบน) — และดู `ข้าม NPC` ว่ากรองออกกี่ตัว
   - **โหมด `Mode 1 (lock)`**: ดูแถว `เป้าที่ DevNight สั่งล็อก` ว่าตรงกับ `เป้าที่เกมใช้อยู่ (m_pTargetedObject @+0x71C)` ไหม (ควรขึ้น **✓ ตรงกัน** ขณะกดคลิกขวา)
       - ถ้า `+0x71C` = ว่าง/ไม่ตรง → เกมเขียนทับ field นี้ → สลับไป **Mode 2 (`soft`)** หรือโหมด `mouse` (สองโหมดนี้ไม่พึ่ง field นี้)
   - **โหมด `Mode 2 (soft)`**: แถว `โหมดการล็อกเป้า` จะขึ้น “ล็อกนุ่ม …” และแถว `เมาส์ที่จะขยับต่อ tick` จะมีค่าขณะกดคลิกขวา (กล้องค่อย ๆ ไถลเข้าหาเป้า) — ถ้ากล้องไม่ขยับเลย ให้ดูแถว `camera matrix` ว่าอ่านได้ไหม (โหมด 2 ต้องอ่านกล้อง) และกด **ปรับเทียบ** เพื่อเช็คว่าฉีดเมาส์ได้
   - **รู้สึกว่า “ล็อกแรง/ดูด/เกาะเป้าจนเกินไป”** → เปลี่ยนเป็น **Mode 2 (`soft`)** ที่ดึงกล้องแบบบางส่วนต่อ tick + จำกัดความเร็วการหมุน (อยากนุ่มกว่านี้/แรงกว่านี้ ให้ปรับ `AIM_SOFT_GAIN` และ `AIM_SOFT_MAX_DEG` ใน `server.js`) — ส่วน **Mode 1** เกมจะตามตัวเป้าให้เองแบบเต็มที่
   - แถว `ความแรงในการดึงกล้องต่อ tick` = `30% ของมุมที่เหลือ · จำกัด 3°/tick` ในโหมด 2 และ `60%` ในโหมด `mouse` (ค่าคงที่ `AIM_SOFT_GAIN = 0.3`, `AIM_SOFT_MAX_DEG = 3`, `AIM_GAIN = 0.6`)
   - **โหมด `mouse`**: `camera matrix @ 0xB6F9E4` อ่านไม่ได้ → address ไม่ตรงกับ build นี้
   - อยากรู้ว่าในโลกมี ped อะไรบ้าง/ผู้เล่นเป็น type ไหน → กดปุ่ม **ดู ped ทั้งหมดในโลก** (ผู้เล่นควรเป็น `PLAYER_NETWORK` หรือ `PLAYER1..` = type 0-3; ถ้าไม่ใช่ ส่งผลมาให้ผมปรับตัวกรอง)
   - **โหมด `mouse`** ทุกอย่างผ่านแต่กล้องยังไม่หัน → กดปุ่ม **ปรับเทียบ (วัดความไวเมาส์)** ขณะอยู่ **ในเกม**:
     - ผลตอบสนองเป็น `ใช่` + ทิศทาง `OK` → ระบบฉีดเมาส์ได้ ใช้งานได้ (ถ้าหมุนเกิน/ช้า ให้ปรับความแรงที่ค่าคงที่ `AIM_GAIN` / `AIM_SOFT_GAIN` ใน `server.js` — ปัจจุบันโหมด `mouse` = `0.6` และโหมด 2 = `0.3` ของมุมที่เหลือต่อ tick)
     - ผลตอบสนองเป็น `ไม่` → **เกมไม่รับการฉีดเมาส์** (ต้องใช้วิธีอื่น)
   - ปุ่ม **ทดสอบเมาส์ → ขวา / ← ซ้าย** ใช้ทดสอบเร็ว ๆ ว่ากล้องหันตามเมาส์ที่ฉีดหรือไม่

> **สาเหตุที่พบบ่อย (แก้แล้วในเวอร์ชันนี้):**
> 1. **`OpenProcess` ไม่ผ่าน (error 5)**: เกมรัน elevated แต่ server ไม่ได้ → *ไม่มีอะไรเกิดขึ้นเลย*
>    แก้โดยรัน server แบบ Administrator (อัตโนมัติ/`start-admin.cmd`/แบนเนอร์เตือนบนเว็บ)
> 2. **address กล้องผิด**: เดิมใช้ `0xB6FA2C` (ไม่ใช่ matrix กล้องจริง — row ไม่ orthonormal)
>    ของจริงคือ **`0xB6F9E4`** (camera world matrix แบบ RwMatrix: right=row0, up=row1, forward=row2, pos=row3)
> 3. **หันกล้องด้วย world_to_screen (NDC)**: เปลี่ยนมาเป็นคำนวณ **yaw/pitch** ในพิกัดกล้องโดยตรง
>    (ไม่ต้องรู้ขนาดจอ) แล้วคูณเป็น mouse counts: `dx = +GAIN×K×yawErr`, `dy = −GAIN×K×pitchErr`
>    โดยวัดได้ **K ≈ 392 counts/radian** (dx>0 = หันขวา/yaw ลด, dy>0 = มองลง/pitch ลด)
> 4. `sizeof(CPed)` ผิด: ใช้ `0x79C` แต่ stride จริงของ ped pool คือ **`0x7C4` (1988)** → หาเป้าไม่เจอ
>    (เวอร์ชันนี้แก้เป็น `0x7C4` + ตรวจ stride อัตโนมัติ)
> 5. **ล็อกผิดตัว (ไปเกาะ NPC)**: เดิมเลือก ped ใกล้สุดโดยไม่ดูชนิด → ไปเกาะ NPC/คนเดินถนน
>    แก้โดยกรองด้วย **ped type** (`CPed::m_nPedType` @ `0x598`): รับเฉพาะ **type 0-3** (player types)
>    ใน SA-MP ผู้เล่นจริงมาเป็น **`PLAYER_NETWORK` (type 2)** ส่วน NPC เริ่มที่ type 4 (CIVMALE) เป็นต้นไป
> 6. **Aimbot พัฒนาเป็น 4 โหมด (เดิมมีแต่กลไกเดียว แล้วเป็น 2 โหมด)**: `lock` (Mode 1 · เขียน target ให้เกมล็อกเอง), `soft` / `snap` (Mode 2/2+ · ยกตรรกะ **HeadShotAimBot** มาทั้งชุด — เขียนมุมกล้อง `0xB6F248`/`0xB6F258` เอง, `soft` ไล่ทีละส่วน, `snap` เขียนเต็มทุก tick) และ `mouse` (สำรอง · `mouse_event`)
>    โดยตอนที่แยกเป็น 2 โหมด ปรับ `lock` ให้เหลือ **Mode 1 (ตามตัวเป้าเต็ม · แบบเดิม)** กับ **Mode 2 `soft`** (ตามเป้าเหมือนกัน แต่ดึงกล้องบางส่วนต่อ tick + จำกัดความเร็วการหมุน ไม่ดูด/ไม่กระชาก) เพราะโหมดเดิมเกมจะเกาะตามตัวเป้าให้เอง ซึ่งดู "เวอร์" เกินไป
>    ล่าสุดย้าย Mode 2 ไปใช้ **ตรรกะจริงของ source HeadShotAimBot** (หันกล้องด้วยการเขียนมุมกล้อง `0xB6F248`/`0xB6F258` เอง) และเพิ่ม **Mode 2+ `snap`** (เขียนมุมเต็มทุก tick ตาม source เป๊ะ)

## โครงสร้างไฟล์

```
server.js        # Express + memory engine (koffi) + keeper loop + REST API
config.json      # นิยามเกม + 4 ฟีเจอร์ (melee/speed/rotation/aimbot · base / pointerOffsets / valueOffset / type / min-max)
start-admin.cmd  # เปิด server แบบ Administrator (สำหรับเกมที่รัน elevated / SA-MP)
public/
  index.html     # โครงหน้าเว็บ
  style.css      # ธีมดำ DevNight
  app.js         # ผูก event, poll status, ส่งค่าเรียลไทม์
```

## API

| Method | Path | หน้าที่ |
|---|---|---|
| GET  | `/api/status` | สถานะ + ค่าปัจจุบันของทุกฟีเจอร์ |
| POST | `/api/detect` | หา + แนบ process ของเกม |
| POST | `/api/detach` | ยกเลิกการแนบ |
| POST | `/api/value` | ตั้งค่า (`{key, value}`) — ถ้ายังไม่ active จะ auto-เปิดใช้ |
| POST | `/api/toggle` | เปิด/ปิดฟีเจอร์ (`{key, active}`) |
| POST | `/api/config` | แก้ offset ขณะรัน (`{key, base, pointerOffsets, valueOffset, type, ...}`) |
| GET  | `/api/diag` | อ่านค่าจริงจาก memory เพื่อเช็ค address (รวมส่วน aimbot + melee + speed run) |
| GET  | `/api/aimbot-debug` | snapshot ทุกขั้นตอนของ aimbot (ใช้โดยแผง Aimbot Debug) |
| POST | `/api/aimbot-test` | ฉีดเมาส์ทดสอบ (`{dx, dy}`) |
| GET  | `/api/aimbot-calibrate` | วัดความไวเมาส์/ทิศทางจริงจากกล้อง (ต้องโฟกัสเกม) |
| POST | `/api/aimbot-option` | ตั้งค่าตัวกรอง/โหมดเป้า (`{playersOnly, playerPedTypes, mode}` · mode = `lock` (Mode 1) \| `soft` (Mode 2) \| `snap` (Mode 2+) \| `mouse` (สำรอง) · ค่าเก่า `hold`→`soft`, `bone`→`snap` ยังรับได้) |
| GET  | `/api/aimbot-peds` | ลิสต์ ped ทุกตัวในโลก (type/createdBy/ระยะ) เพื่อดูว่าใครเป็นผู้เล่น |
| POST | `/api/melee-option` | ตั้งโหมด Melee Speed (`{mode}` · `timing` \| `anim` \| `both`) |
| POST | `/api/mode-option` | ตั้งโหมดของฟีเจอร์ที่มีตัวเลือก (ใช้ร่วมกัน melee + speed run + aimbot) — `{key, mode}` |
| POST | `/api/extra` | ตั้ง **สไลเดอร์ที่ 2** ของการ์ดแบบทั่วไป (ฟีเจอร์ใดประกาศ `extras` ใน config จะได้สไลเดอร์ที่ 2 อัตโนมัติ) — `{key, field, value}` · **ตอนนี้ยังไม่มีฟีเจอร์ไหนใช้** |
| GET  | `/api/melee-debug` | snapshot ค่า `melee.dat` ปัจจุบัน + ลิสต์อนิเมชันที่กำลังเล่นบนตัวผู้เล่น |

## หมายเหตุ / ข้อจำกัด

- ที่อยู่เป็นแบบ **absolute** (GTA SA v1.0 โหลดที่ `0x400000`) ยังไม่รองรับแบบ `module+off`
- GTA SA เป็น 32-bit จึงอ่าน pointer เป็น 4 บิตเสมอ
- **Speed Run** — กลไก "เร่งอนิเมชันเดิน/วิ่ง" (โหมด `anim` · ค่าเริ่มต้น) อาศัยความจริงของ GTA SA ว่า
  การเดิน/วิ่งของผู้เล่น **ขับเคลื่อนด้วยอนิเมชันเอง**: ท่า WALK/RUN/SPRINT มี flag `ANIMATION_CAN_EXTRACT_VELOCITY`
  ความเร็วจึงดึงจากรากของอนิเมชัน (เหตุผลเดียวกันที่ทำให้ NPC แต่ละตัวเดินเร็วไม่เท่ากัน เพราะ `CPed::SetMoveAnimSpeed()`
  สุ่ม `m_Speed` ≈ 0.8–1.2) และ **`CPlayerPed::SetMoveAnim()` เป็น no-op** → เกมไม่เขียนทับค่าของเรา · DevNight เขียน
  `CAnimBlendAssociation::m_Speed` @ `+0x24` เฉพาะ assoc ที่ `m_nAnimId` ∈ {`0` WALK, `1` RUN, `2` SPRINT} — **ท่า idle / ฟัน /
  ยิง / ถือของไม่ถูกแตะ** · เขียนซ้ำทุก ~16 มิลลิวินาที (assoc ถูกสร้าง/ทำลายขณะขยับ) · ปิดสวิตช์ → คืน `1.0` · ดูค่าสดที่แผง
  **Diagnostic** ส่วน **Speed Run** (`isRun` = แถวสีเขียว)
- ค่า **Rotation** เป็นการเดาจาก offset โครงสร้างจริง — ต้องทดสอบในเกม
  ถ้าไม่ได้ผล ให้แก้ offset ใน Advanced (ตัวเลือกอื่นที่น่าสนใจ: `m_nAttackTimer=0x74C`,
  `m_nWeaponShootingRate=0x719` สำหรับ melee, `m_fHeadingCurrent=0x558` สำหรับตั้งมุมหมุนโดยตรง)
- **Melee Speed** (ดูส่วน **Melee Speed** ในแผง Diagnostic และ `/api/melee-debug`):
  - **โหมด `timing`**: หาร `m_fHit[]`/`m_fChain[]` ของ `CMeleeInfo[12]` @ `0xC170D0` (stride `0x88`) ด้วยตัวคูณ → ตีโดนเป้าเร็วขึ้น + กดต่อคอมโบได้เร็วขึ้น
  - **โหมด `anim`**: เขียน `m_Speed` ของ `CAnimBlendAssociation` ที่กำลังเล่น **ท่า melee** เท่านั้น (หา assoc จาก `ped+0x18` (RpClump) → plugin offset อ่านสด ๆ จาก global `0xB5F878` → `CAnimBlendClumpData::m_AnimList` @ `+0x00`) โดยจับคู่ **anim group** กับค่าใน `m_aComboData` → อนิเมชันวิ่ง/เดินจะไม่ถูกแตะ
  - ค่าอาวุธ melee ใน weapon.dat มีแค่ `baseCombo`/`numCombos`/`flags` ไม่มี animLoop → `CWeaponInfo` ใช้ไม่ได้ (ดูหมายเหตุด้านบน)
- **Aimbot** มี 4 โหมดในฟิลด์ `mode` (เลือกได้ทั้งที่**การ์ด**และในแผง **Aimbot Debug** · `/api/mode-option` และ `/api/aimbot-option`):
  - ทุกโหมดเริ่มจาก: สแกน ped pool (`0xB74490`) → **กรองเอาเฉพาะผู้เล่นจริง** ด้วย `CPed::m_nPedType` @ `0x598` (รับ type 0-3) → หาเป้าใกล้สุดในระยะ · ล็อกแบบ `sticky` (เกาะเป้าเดิมจนกว่าจะปล่อยคลิกขวา / เป้าตาย / เป้าหลุดระยะ)
  - **`mode: "lock"` = Mode 1 — ล็อกเต็ม ตามตัวเป้า**: เขียน pointer ของเป้าลง **`CPed::m_pTargetedObject` @ `ped+0x71C`** และ **`CPlayerPed::m_p3rdPersonMouseTarget` @ `ped+0x79C`** ขณะกดคลิกขวา แล้ว **เกมเป็นคนล็อก/เล็งและตามตัวเป้าให้เอง** (เกมอ่าน field นี้ทุกเฟรมใน `CPlayerPed::ProcessControl()` — ใช้วาด mark ที่เป้าและเลือก target bone) · **ไม่ฉีดเมาส์** · ปล่อยคลิกขวา/เป้าหลุด → เขียน `0` คืน (เฉพาะเมื่อค่ายังเป็นเป้าที่เราสั่ง · จำค่าไว้ใน `f._nativeTarget`)
  - **`mode: "soft"` = Mode 2 (ค่าเริ่มต้น) — ล็อกนุ่ม ตาม source**: ยกตรรกะ **`AimbotSystem::aimAtPosition()`** ของ HeadShotAimBot (source ต้นแบบ) มาเป็น JS — **ไม่** เขียน native target และ **ไม่** ฉีดเมาส์ แต่ **หันกล้องเอง** โดยเขียน **มุมกล้อง `0xB6F248` (X) / `0xB6F258` (Z)** ตรง ๆ (สิ่งที่ CLEO opcode `0A25` ทำ):
    - อ่านตำแหน่งกล้องจาก `0xB6F03C` (`TheCamera+0x14` → CPlaceable matrix: `+0x20` forward, `+0x30` position) เหมือน `getCameraState()` ของ source
    - คำนวณมุม: `xAngle = pitchRaw - xOff`, `zAngle = -(yawRaw - π/2 - zOff)` โดย `pitchRaw = atan2(dz, horizDist)`, `yawRaw = atan2(-ddx, ddy)` (`getATanOfXY`) และ `xOff`/`zOff` คือการแก้ FOV + ตำแหน่งเส้นเล็งจาก `0x8D5038` / `0xB6EC10` / `0xB6EC14` / `0xC3EFA4` (อ่านไม่ได้ตัวใดตัวหนึ่ง → ใช้ค่าชดเชย 0)
    - **ไล่มุม** แค่ `AIM_SOFT_GAIN = 0.3` ของมุมที่เหลือต่อ tick และ **จำกัดไม่เกิน `AIM_SOFT_MAX_DEG = 3°` ต่อ tick** → กล้องไถลเข้าหาเป้าแบบนุ่ม (ไม่กระชาก/ไม่ดูดแบบ Mode 1) · เป้าวิ่ง = ตามหลังอยู่เล็กน้อย · อยากนุ่มกว่านี้ให้ลด `AIM_SOFT_GAIN`/`AIM_SOFT_MAX_DEG`
  - **`mode: "snap"` = Mode 2+ — ตาม source เป๊ะ**: กลไกเดียวกันทั้งหมด แต่ **เขียนมุมกล้องเต็มทุก tick** (ไม่ไล่ทีละส่วน ไม่จำกัดความเร็ว) = พฤติกรรมเป๊ะของ `AimbotSystem::aimAtPosition()`
  - **`mode: "mouse"` (สำรอง)**: อ่าน **camera world matrix (`0xB6F9E4`)** แล้วคำนวณมุม **yaw/pitch** ที่ต้องหัน → `mouse_event` ขยับกางเขนไปที่เป้า **ทุก ~16 มิลลิวินาที** ด้วย `AIM_GAIN = 0.6` และไม่จำกัดความเร็วการหมุน (ตามตัวเป้าเต็มที่) — ใช้เมื่อการเขียนมุมกล้อง/Mode 1 ไม่ทำงานกับ build นี้
  - **จุดที่ต่างจาก source (โดยตั้งใจ)**: (1) `CPed::GetBonePosition` @ `0x5E4280` เป็นฟังก์ชันใน `gta_sa.exe` 32-bit — โปรเซส Node 64-bit เรียกไม่ได้ จึงใช้ **ped origin + `AIM_BONE_H = 0.8 ม.` (≈ BONE_HEAD)** เป็นจุดเล็ง; (2) การเลือกเป้าใช้ **ผู้เล่นจริงที่ใกล้สุด** (ตามสเปกของ DevNight) ไม่ใช่การยิงเส้นจากปากกระบอกผ่านเส้นเล็งแบบ source; (3) source เปิดค้างด้วยคีย์ Alt+1 แต่ DevNight ผูกกับ **คลิกขวา** ตามสเปกเดิม
  - ตัวกรองเป้าตั้งใน `config.json` ของฟีเจอร์ aimbot: "playersOnly": true, "playerPedTypes": [0,1,2,3], "mode": "soft"
  - ค่าคงที่ที่เกี่ยวข้องใน `server.js`: `CAM_PLACEABLE=0xB6F03C`, `CAM_ANGLE_X=0xB6F248`, `CAM_ANGLE_Z=0xB6F258`, `CAM_FOV=0x8D5038`, `CAM_CROSS_X=0xB6EC10`, `CAM_CROSS_Y=0xB6EC14`, `CAM_ASPECT=0xC3EFA4`, `AIM_BONE_H=0.8`, `AIM_CAM_PITCH=1.5`, `AIM_SOFT_GAIN=0.3`, `AIM_SOFT_MAX_DEG=3`, `AIM_GAIN=0.6`, `AIM_COUNTS_PER_RAD=392`, `AIM_MAXD=160`, `AIM_DROP=1.6`
  - `m_nCreatedBy` @ `0x484`, `m_pPlayerData` @ `0x480` ใช้เป็นข้อมูลเสริมใน `/api/aimbot-peds`
  - ถ้ากล้อง (Mode 2/2+) หรือเมาส์ (`mouse`) หันผิดทาง ให้ดูผลในแผง **Aimbot Debug** (แถวมุมกล้องปัจจุบัน/มุมที่ aimbot จะเขียน/มุมที่ต้องหันอีก) แล้วสลับเครื่องหมายใน `aimAngles()` (โหมด 2) หรือ `aimSolution()` (โหมด mouse)
