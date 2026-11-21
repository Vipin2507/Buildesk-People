# Platform Super Admin and multi-client workspaces

Buildesk People can run as a multi-client HRMS platform with:

- A **control-plane** SQLite database at `data/platform/platform.sqlite`
- One **tenant** SQLite database per client at `data/tenants/{workspaceId}/buildesk.sqlite`
- Separate Platform Admin identity (`buildesk_platform_session`) and client HRMS identity (`buildesk_session`)

## Local development

1. Copy `.env.example` to `.env` and set platform owner bootstrap values for first run only.
2. `npm run dev`
3. Open `/admin/signin` and sign in as the platform owner.
4. Create a workspace (or adopt the legacy database).
5. Client users sign in at `/signin` with email + password. No tenant slug is required.

## Environment flags

| Variable | Purpose |
| --- | --- |
| `BUILDESK_MULTI_TENANT` | Force multi-tenant on/off. If unset, enables automatically when a ready workspace exists. |
| `BUILDESK_LEGACY_SINGLE_TENANT` | Allow login against `data/buildesk.sqlite` when the email is not in the global directory. Default `true`. |
| `BUILDESK_PLATFORM_OWNER_EMAIL` / `PASSWORD` / `NAME` | Create the first platform owner if none exist. Never resets an existing password. |

## Isolation model

- Control-plane stores operators, plans, workspaces, email directory, platform audits, and sessions.
- Tenant DBs store employees, payroll, attendance, leave, tickets, assets, policies, documents, and settings.
- Request handlers bind tenant context via `AsyncLocalStorage` from the client session’s workspace id.
- Platform routes (`/api/platform/*`) use only the platform cookie and never open tenant HR queries for support browsing.

## Client login (no slug)

1. Normalize email and look up `email_directory`.
2. Reject suspended/expired/archived/not-ready workspaces before password checks.
3. Open that tenant database and verify credentials.
4. Issue a client session bound to `workspaceId` + `accountId`.

## Provisioning

Platform Admin → Client Workspaces → Create workspace:

1. Validates company, slug, admin email, plan.
2. Creates tenant folder + SQLite and seeds minimum admin/settings.
3. Registers admin email globally.
4. Marks provisioning `ready` (or `failed` without deleting a live DB on later failures).

## Legacy migration (explicit)

1. Backup `data/buildesk.sqlite` and `data/photos|policies|payslips`.
2. In Platform Admin, use **Adopt legacy data**.
3. This **copies** the legacy DB into `data/tenants/{id}/` and registers account emails. The original file remains for rollback.
4. Verify client login with an existing email.
5. Set `BUILDESK_LEGACY_SINGLE_TENANT=false` only after verification.
6. Optionally archive/remove the legacy file once you no longer need rollback.

## Suspension, expiry, deletion

- Suspend / expire / archive: blocks client login and tenant APIs; data retained; client sessions cleared.
- Reactivate: restores access without rewriting tenant records.
- Permanent delete: platform owner only, typed slug confirmation, disconnects DB handle, deletes tenant folder, audited.

## Backups

Back up each tenant folder under `data/tenants/{id}/` individually. Restore only into the matching workspace id. Do not restore one tenant’s file over another.

## Acceptance checks

1. Platform operator reaches `/admin` only with the platform cookie.
2. Client user cannot call `/api/platform/*` successfully.
3. Platform cookie cannot call client `/api/actions`.
4. Two workspaces keep separate employee records.
5. Duplicate emails across workspaces are rejected by the directory.
6. Client login resolves workspace from email alone.
7. Suspended workspace blocks login and APIs without deleting data.
8. Employee creation respects plan limits server-side.
9. Overview still lists workspaces when one tenant DB is missing.
10. Legacy data is not moved/deleted unless you explicitly adopt and later remove it.
