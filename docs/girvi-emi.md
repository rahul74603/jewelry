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

## Interest — manual, simple, monthly

- Byaj rate **har record par shopkeeper apne hisab se dalta hai**
  (0–100% per month) aur record banne ke baad kabhi nahi badalta.
- **Monthly simple interest on the outstanding principal.** Interest
  per completed calendar month lagta hai: 15 Oct ko shuru hua loan par
  15 Nov ko 1 mahine ka byaj, 14 Nov ko 0.
- **Payment pehle byaj me, phir principal me jati hai.** Isliye byaj
  time par bharne se principal nahi ghatta, aur extra payment se
  principal ghatta hai — aur aage ke mahino ka byaj bhi kam ho jata
  hai.
- Har record dikhata hai: principal, aaj tak ka byaj, kul due, ab tak
  bhara, balance. Pure hisaab `functions/src/core/loans.ts` me hai
  (`loanSummary`, `wholeMonthsBetween`) — demo mutation, server
  handler aur UI teeno wahi use karte hain.

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
- Forfeited record par aur payment nahi ho sakti; payment balance se
  zyada ki nahi ho sakti.

## Reminders — in-app, WhatsApp one-tap

- Due-today / overdue list Girvi & EMI page par sabse upar hoti hai.
- Har due record ke liye Hindi message banta hai:
  “Namaste [name] ji, aapka [shop] me ₹X bakaya hai. Is mahine ka
  byaj ₹Y bana, kul ₹Z ho gaya hai. Kripya jald bhugtan karein.”
  (X = outstanding principal, Y = is mahine ka byaj, Z = kul due.)
- **WhatsApp one-tap:** button dabate hi WhatsApp khulta hai, message
  pehle se bhara hota hai — bas send dabana hai. Bina number ke link
  WhatsApp share sheet kholta hai, jahan contact chuna ja sakta hai.
- **Automatic SMS nahi bana** (SEND_SMS permission + channel decision
  pending) aur **native 02:00 scheduler nahi bana** — daily check
  backup wale daily-on-open pattern par hai.

## Backup & restore

- Girvi / EMI records workspace ki 7th collection hain (`loans`,
  `functions/src/core/model.ts`). Yearly backup file
  (`aurum-backup-<shop>-<YYYY>.json`) me inki count bhi hoti hai, aur
  restore inhe wapas lata hai. Is module se pehle ke backup (jinme
  loans nahi hai) ab bhi restore hote hain — unke liye `loans: []`
  bhar diya jata hai.

## Data model

- `functions/src/core/model.ts`: `loanSchema`, `loanPaymentSchema`,
  `loanPaymentInputSchema`, `loanForfeitInputSchema`; `Workspace.loans`;
  Actions `"loan"`, `"loanPayment"`, `"loanForfeit"`.
- `functions/src/core/loans.ts`: pure logic (interest, summary,
  states, due list, reminder text, WhatsApp link, forfeited product).
- `src/lib/demo.ts`: `demoMutation` cases + 3 sample records
  (1 overdue girvi, 1 due-soon girvi, 1 active EMI).
- `functions/src/server/workspace.ts`: live-mode handlers + restore
  (loans bucket, counts).
- Tests: `tests/loans.test.ts` (24 tests — interest, allocation,
  overdue, forfeit, backup round-trip).
