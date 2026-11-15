# Privacy operations (DPDP Act 2023 / DPDP Rules 2025)

Core obligations apply from 13 May 2027. Points marked **(verify with counsel)** are our reading of the law, not legal advice.

## Contacts and configuration

- Grievance officer: set `GRIEVANCE_NAME` and `GRIEVANCE_EMAIL` in the API environment. They are served publicly at `GET /privacy/contact` and shown in the mobile Profile and web Settings screens.
- Consent: `POST /users/me/consent {version, isAdult}` stores `consentVersion`, `consentedAt` and `isAdult` on the user. Bump the version (`v1` today) when the privacy notice changes; the apps send it at onboarding.
- Rights: access via `GET /users/me/export` (JSON), erasure via `DELETE /users/me` (all Postgres rows in one transaction, then the Firebase Auth user).

## Breach response runbook

1. **Detect and contain** (hour 0): revoke leaked credentials/keys (Firebase service account, `DATABASE_URL`, Google OAuth, Qdrant, Groq), block the attack path, preserve logs and snapshots. Name an incident lead.
2. **CERT-In, within 6 hours** of noticing the incident: report via incident@cert-in.org.in using the CERT-In form (CERT-In Directions, 28 April 2022). **(verify with counsel)**
3. **Affected users, without delay**: tell each affected user, in plain language, what happened, what data was involved, likely consequences, what we did, what they should do, and the grievance contact. Use email plus in-app push. **(verify with counsel)**
4. **Data Protection Board**: an initial intimation without delay, and a detailed report **within 72 hours** of becoming aware (facts, timing, cause, mitigation, findings about the person responsible, user notifications sent). **(verify with counsel)**
5. **Close out**: root cause, fixes, and a written record of the incident and every notification sent.

## Retention

- Security / access logs (API, Postgres, Firebase Auth): keep at least **1 year** (DPDP Rules; CERT-In asks for 180 days in India). **(verify with counsel)**
- Personal data: kept while the account exists. `DELETE /users/me` erases it at once; there are no delayed purges or backups we control beyond the database provider's point-in-time recovery window — note that window here once confirmed.
- Inactive accounts: the Rules allow erasure after a period of inactivity for some classes of fiduciary, with 48 hours' notice. Not implemented. **(verify with counsel whether it applies)**
- Soft-deleted rows (`isDeleted = true`) are kept for sync and are included in exports and removed by account deletion.

## Personal data we store

| Where | Fields |
| --- | --- |
| `users` | Firebase UID, email, name, photo URL, FCM push token, Google Sheets connected flag, sheet id, encrypted Sheets OAuth token, last synced at, consent version/time, 18+ flag, created/updated |
| `accounts` | name, type, current/opening balance, credit limit, last 4 digits of account number, colour |
| `expenses` | amount, category/subcategory, note, date, payment method, source (manual/SMS), merchant, account, transfer account, review flags |
| `budgets` | month, category, limit |
| `loans` | type, counterparty name, principal, total, repayment date, status, notes, interest rate |
| `investments` | type, name, monthly amount, principal, maturity amount/date, duration, interest rate, institution |
| `categories`, `category_rules` | custom categories and merchant-to-category rules |
| `chat_conversations`, `chat_messages` | assistant chat titles, questions and answers |
| Firebase Auth | sign-in identity (email, name, photo, provider) |
| User's own Google Sheet | copy of transactions when Sheets sync is on (in the user's Drive, not ours) |
| Devices | local Isar copy of the above on mobile |

Qdrant holds only the shared finance knowledge base, no user data. Personal financial context is built per request for the assistant and sent with the question to the LLM provider (Groq) as a processor; it is not stored outside Postgres on our side. **(verify Groq's retention terms and list it as a processor in the privacy notice)**
