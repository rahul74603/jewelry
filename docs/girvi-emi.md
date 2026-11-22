# Girvi & EMI (pawn loans + instalment sales)

Soni ki dukaan ka asli kaam — billing ke alawa do cheezein jo har
jeweller roz karta hai. Branch: `feature/offline-backup-activation`.
Page: **Girvi & EMI** (`/loans`, `src/pages/Loans.tsx`).

## Two record types, one module

**Girvi (pawn):** customer apni jewellery rakh ke byaj par cash le
jata hai, ek date de jata hai. Fields: customer, item (name, metal,
purity, weight — weight girvi ke liye zaroori hai), cash given
(principal), **manual interest rate (% per month)**, start date,
validity / due date, payments, status.

**EMI / kist:** customer sone ka item le jata hai, kuch abhi deta hai,
baaki kist me — ya jab chahe jitna chahe de deta hai. **Koi fixed kist
nahi.** Fields: customer, item, item price (total), upfront paid,
**manual interest rate (% per month)**, payments, status. Principal =
total − upfront.

## Interest — manual, simple by default, compound on request

- Byaj rate **har record par shopkeeper apne hisab se dalta hai**
  (0–100% per month) aur record banne ke baad kabhi nahi badalta.
- **Monthly interest on the outstanding principal.** Interest per
  completed calendar month lagta hai: 15 Oct ko shuru hua loan par
  15 Nov ko 1 mahine ka byaj, 14 Nov ko 0.
- **Payment pehle byaj me, phir principal me jati hai.** Isliye byaj
  time par bharne se principal nahi ghatta, aur extra payment se
  principal ghatta hai — aur aage ke mahino ka byaj bhi kam ho jata
  hai.
- **Mahine-wise byaj:** har poora mahina ek bucket hai — label us
  mahine ka naam hai jis din byaj poora hua ("July", "September").
  Payment sabse purane bucket se pehle bharta hai. Record detail me
  har mahine ki line dikhti hai: byaj kitna, ✓ jab poora bhara, baki
  kitna.
- **Chakravarti byaj (compound) — per record ON/OFF, default OFF.**
  OFF ho to simple byaj: har mahine sirf outstanding principal par.
  ON ho to har mahine ki boundary par baki byaj principal me jud
  jata hai, aur agle mahine ka byaj principal + baki byaj par lagta
  hai. Example: ₹1,00,000 @2% — simple: 2 mahine me ₹4,000;
  compound: ₹2,000 + ₹2,040 = ₹4,040. Toggle add-record form me aur
  record detail me hai — badalne par poora record phir se hisaab
  hota hai (shuru se, naye niyam se). Sirf active record par badal
  sakta hai.
- Har record dikhata hai: principal, aaj tak ka byaj, kul due, ab tak
  bhara, balance. Pure hisaab `functions/src/core/loans.ts` me hai
  (`loanSummary`, `wholeMonthsBetween`, `monthBoundaries`) — demo
  mutation, server handler aur UI teeno wahi use karte hain.

## Due dates, overdue, forfeit (girvi only)

- Due date nikal jaye aur balance baki ho to record **overdue** hota
  hai; due date se 7 din pehle se **due soon**. Dashboard roz subah
  (app khulte hi — daily-on-open, backup reminder wala pattern) due /
  overdue records dikhata hai.
- **Forfeit:** girvi record par date nikalne ke baad shopkeeper ek tap
  se confirm karta hai — app khud forfeit nahi karta. Forfeit par:
  record `forfeited` ho jata hai, aur collateral item **stock me aa
  jata hai** (Inventory, category “Forfeited”, 1 pc, cost = forfeit ke
  time ka balance). EMI record forfeit nahi ho sakta; pura bhugtan
  hone par record `repaid` hota hai.
- Forfeited record par aur payment nahi ho sakti.
- **Manual payment:** Record payment me koi bhi amount dala ja sakta
  hai — balance se zyada bhi. Zyada amount extra record hota hai aur
  record repaid ho jata hai (balance kabhi negative nahi hota).
- **Mamla khatam (settlement):** balance se kam amount dekar mamla
  khatam kiya ja sakta hai. Record `settled` ho jata hai, settlement
  amount payment ki tarah record hota hai, aur baaki rakam waived
  (maaf) dikhti hai. Settlement amount balance se kam hona chahiye —
  poora payment ho to Record payment use karen. Settled record par aur
  payment nahi ho sakti, aur wo due list me nahi aata.

## Status colours — ek nazar me rang

Har record ka rang uski haalat batata hai — list me Status badge aur
row ke left accent, dono me wahi rang hota hai (detail modal ke badge
me bhi). Rang `loanStatusTone()` se aata hai:

- **Green (hara) — clear ho gaya:** record `repaid` (balance ₹0 —
  poora bhugtan mil gaya) ya `settled` (mamla khatam, baaki maaf).
- **Yellow (peela) — chal raha hai:** record `active` ya `due-soon`
  (due date 7 din ke andar) — time par hai, payment aa raha hai.
- **Red (laal) — due pe due:** record `overdue` — due date nikal
  gayi aur balance baki hai, mahine ka byaj judta ja raha hai.
- **Grey (saleti) — forfeited:** record band ho gaya par payment se
  nahi — date nikalne par item stock me gaya.

"Active records" wali ginti me sirf khule hue record aate hain —
repaid, settled aur forfeited usme nahi gine jate.

## Payment confirmations — ✓ aur receipt

- Payment record karte hi confirmation dikhta hai: bada **✓ "Payment
  mil gaya"** + amount + baki balance, aur **WhatsApp receipt** button
  — receipt me customer ka naam, amount, date aur baki bakaya hota
  hai ("Namaste X ji, [shop] ko ₹Y mila — dhanyavad! [date] ko
  payment mila. Ab kul bakaya ₹Z hai."). Settlement par receipt me
  "Mamla khatam — ₹W maaf kar diya gaya" bhi likha hota hai.
- Payment history ki har entry par **✓** hota hai, aur mahine-wise
  byaj list me har mahine par **✓** jab uska byaj poora bhara ho —
  isliye customer ko bhi saaf dikhta hai kya baki hai, aur aage ka
  hisaab clear rehta hai.

## Quick payment — "Payment liya" (counter par ek tap)

- Due list me hi har record par **"Payment liya"** button hota hai —
  record detail kholne ki zaroorat nahi. Cash counter par lete hi ek
  tap me record ho jata hai, "baad me kar dunga" pending nahi rehta.
- Sheet me amount pehle se bhara hota hai: default **"Poora bakaya"**
  (kul balance due), aur chip se **"Sirf is mahine ka byaj"** (ek
  mahine ka charge = rate × outstanding principal) chuna ja sakta hai;
  custom amount bhi type kar sakte hain. Mode Cash default hai.
- Ek confirm tap normal Record payment path se jata hai — interest-first
  allocation aur manual overpayment / settlement rules wahi rehte hain.
  Record karte hi wahi **✓ "Payment mil gaya"** confirmation + WhatsApp
  receipt dikhta hai, bhare hue mahine turant **✓** ho jate hain, aur
  poora bhara hua record due list se turant hat jata hai.
- Record detail wala **"Record payment"** form bhi waisa hi hai —
  date/note ke sath payment ke liye.

## Reminders — in-app, WhatsApp one-tap

- Due-today / overdue list Girvi & EMI page par sabse upar hoti hai.
- Har due record ke liye Hindi message banta hai. Sirf **baki (unpaid)
  mahine** naam se likhe jate hain:
  “Namaste [name] ji, aapka [shop] me ₹X bakaya hai. July aur
  September ka byaj mila kar ₹Z hua, kul ₹W ho gaya hai. Kripya jald
  bhugtan karein.”
  (X = outstanding principal, Z = ab tak ka poora baki byaj,
  W = kul due.)
- Agar abhi tak koi byaj nahi bana hai (poora mahina nahi hua), to
  message saaf likhta hai: “Abhi tak byaj nahi bana hai, kul ₹X hai.”
  — pehle wali wording ("is mahine ka byaj bana") confusing thi,
  kyunki lagta tha wo byaj kul me jud gaya hai, jabki poora mahina
  hone se pehle wo judta nahi.
- **WhatsApp one-tap:** button dabate hi WhatsApp khulta hai, message
  pehle se bhara hota hai — bas send dabana hai. Bina number ke link
  WhatsApp share sheet kholta hai, jahan contact chuna ja sakta hai.
- **Automatic SMS:** roz subah 10 baje — neeche "Automatic daily SMS"
  section dekhen.

## Automatic daily SMS — roz subah 10 baje

- **Kaise kaam karta hai:** loans app ke local store me hain, jise
  native worker seedha nahi padh sakta. Isliye har app open par JS
  due reminders (record id, customer phone, message text) compute
  karke native side ko deta hai (SharedPreferences me save hota hai);
  subah 10 baje worker us payload se SMS bhejta hai. App band ho tab
  bhi chalta hai.
- **10:00 baje ka target:** phone ke andar ka scheduler use hota hai —
  exact alarm (`setExactAndAllowWhileIdle`, `SCHEDULE_EXACT_ALARM`
  permission ke sath) jab phone allow kare, warna WorkManager daily
  work (24 ghante ka interval, 10:00 tak ka initial delay). **10:00
  sharp ki guarantee nahi hai** — Doze / battery optimization alarm ko
  10–15 minute (kuch phones par zyada) shift kar sakta hai. Settings me
  battery-optimization se exempt karne ka button hai (system screen
  khulta hai, force nahi kiya jata).
- **Permission:** SEND_SMS permission sirf tab manga jata hai jab
  shopkeeper Settings me auto-SMS ON kare — app launch par kabhi
  nahi, isliye CI emulator test par koi dialog nahi aata.
- **SIM cost:** SMS shopkeeper ke apne SIM/plan se jata hai — usually
  unlimited pack me free. WhatsApp automatic free me possible nahi hai
  (Business API paise leta hai), isliye SMS.
- **Ek din me ek hi baar:** ek record ko ek din me ek hi baar SMS
  jata hai — native sent-log me per-day mark rehta hai. Bina number
  wale record skip hote hain (due list me "number nahi hai" dikhta
  hai). Girvi & EMI page par "aaj SMS bhej diya ✓" bhi dikhta hai.
- **Retry / catch-up — message kabhi khoyega nahi, next month ka
  intezar nahi:** failed send ko "sent" nahi mana jata (us din ka mark
  nahi lagta); worker transient failure (no signal) par `Result.retry()`
  deta hai aur same day dobara try karta hai; jo reh gaya wo agle din
  subah 10 baje phir try hota hai, kyunki record payment hone tak
  due/overdue rehta hai — reminder roz repeat hota hai, mahine me ek
  baar nahi. Failed attempts sent-log me "failed — retry pending"
  dikhte hain. SMS ko internet nahi, mobile signal chahiye.
- **Band karna:** toggle OFF karte hi scheduler ruk jata hai (alarm +
  WorkManager cancel). Default OFF hai.
- **Test SMS:** Settings se apne number par ek test SMS bhej kar check
  kar sakte hain.
- Files: `android/app/src/main/java/com/aurum/jewellery/` —
  `SmsReminderPlugin.java`, `SmsSender.java`, `SmsSentReceiver.java`,
  `SmsReminderStore.java`, `ReminderWorker.java`,
  `SmsReminderScheduler.java`, `SmsAlarmReceiver.java`,
  `SmsBootReceiver.java`; `src/lib/autoSms.ts` (payload, settings,
  sent-log); Settings me `AutoSmsSection` (`src/pages/Management.tsx`).
  Tests: `tests/autoSms.test.ts`.

## Backup & restore

- Girvi / EMI records workspace ki 7th collection hain (`loans`,
  `functions/src/core/model.ts`). Yearly backup file
  (`aurum-backup-<shop>-<YYYY>.json`) me inki count bhi hoti hai, aur
  restore inhe wapas lata hai. Is module se pehle ke backup (jinme
  loans nahi hai) ab bhi restore hote hain — unke liye `loans: []`
  bhar diya jata hai.
- Naye fields (compound flag, settled status + waived amount, payment
  ka extra) bhi backup/restore se guzarte hain. Inse pehle ke backup
  jinme ye fields nahi hain, ab bhi restore hote hain — compound
  default OFF, status active, extra 0.

## Data model

- `functions/src/core/model.ts`: `loanSchema`, `loanPaymentSchema`,
  `loanPaymentInputSchema`, `loanForfeitInputSchema`,
  `loanSettleInputSchema`, `loanCompoundInputSchema`; `Workspace.loans`;
  Actions `"loan"`, `"loanPayment"`, `"loanForfeit"`, `"loanSettle"`,
  `"loanCompound"`.
- `functions/src/core/loans.ts`: pure logic (interest, month buckets,
  compound, summary, states, due list, reminder text, receipt text,
  WhatsApp link, forfeited product, quick-pay amounts).
- `src/lib/demo.ts`: `demoMutation` cases + 3 sample records
  (1 overdue girvi, 1 due-soon girvi, 1 active EMI).
- `functions/src/server/workspace.ts`: live-mode handlers + restore
  (loans bucket, counts).
- Tests: `tests/loans.test.ts` (51 tests — interest, buckets,
  compound, manual payment, settlement, reminders, receipt, forfeit,
  quick-pay amounts, status tones, backup round-trip) and `tests/autoSms.test.ts`
  (18 tests — payload, dedup, settings, sent log).
