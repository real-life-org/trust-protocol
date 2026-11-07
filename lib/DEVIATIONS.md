# Deviations from the specification

Every place where this library knowingly reads a specification differently
from its text is listed here, with the issue that asks the next casting to
settle it. `test/deviations.test.mjs` checks that every `DEVIATION <id>`
marker in `src/` has a row here and that every row with code names a file
that carries its marker; `scripts/check-deviations-issues.mjs` (CI) fails
once an issue is closed while its row still stands, so a settled
specification cannot leave a deviation behind unnoticed.

A row is `pending` until the code that carries it lands; then `code` names
the files.

| id | issue | code | since | reading until settled |
|---|---|---|---|---|
| D1 | https://github.com/real-life-org/trust-protocol/issues/154 | `src/access/exchange.ts`, `src/membership/replica.ts` | 0.13.0 | The stage-1 group log types `x-access-entry/0.1`, `x-access-sync/0.1`, `x-access-page/0.1` are replication ingress (Replication 7.1, 7.3, I14), not signals under Access 3370, although they travel as trust tasks. |
| D2 | https://github.com/real-life-org/trust-protocol/issues/155 | `src/access/log.ts` | 0.13.0 | A `member.leave` defeats every `member.add` of its subject that is not causally after it (leave ∥ add of one subject, absent from the matrix of Access 3.6); no re-admission after a leave, read from rule 0 with pending exits as members (3315, 5400). |
| D3 | https://github.com/real-life-org/trust-protocol/issues/156 | `src/access/genesis.ts`, `src/keys-seed.ts`, `src/ports.ts` | 0.13.0 | The founder's `serviceIdentity` in the genesis is derived per person and group from the root IKM with the group DID as input, under the prefix `rltp/v1/x-service-identity-stage1/`, because Identity §7's derivation needs the genesis digest the genesis itself fixes (Access 3265). |
| D4 | https://github.com/real-life-org/trust-protocol/issues/157 | `src/access/log.ts` | 0.13.0 | A back-dated `member.add` authored by a member who has left has no disposition; the library names the risk and applies the operation where it is valid at its position (Access 3325). |
