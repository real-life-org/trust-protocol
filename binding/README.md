# binding-vti — die Wire-Bindung unter dem Adapter

Die konkrete `MediatorWire`-Implementierung über `@openvtc/vti-didcomm-js`
0.12.0 und `@openvtc/vti-tsp-js` 0.3.0 (TSP **Rev 3**: HPKE-Base,
Außensignatur). **Dev-only** — nie eine Abhängigkeit der
zero-dependency lib; das Profil (`spec/adapter-vti-mediator.md` §7)
benennt genau die Pflichten, die hier wohnen.

## Was hier liegt

- `vti-wire.mjs` — `createVtiWire(cfg)`:
  - leitet die **Wire-Identitäten aus derselben HKDF** ab wie die
    lib (gleiche Präfixe → byte-identische DIDs zum Adapter-Trio;
    gemessen in der Probe);
  - ATM-Auth unter der Connection-DID, ein Pickup-Socket;
  - `deposit` = TSP-Rev-3-Direct-Pack des versiegelten RLTP-Envelopes:
    HPKE-Base an den X25519-Schlüssel der Connection-DID des Partners,
    Ed25519-Außensignatur des Senders, **Sender = Egress-Identität**
    (§5a.10);
  - `onDeliver` entpackt den TSP-Rahmen, verlangt Rev 3 und genau das
    Paar (Partner-Egress → eigene Connection-DID), und reicht die
    **inneren Payload-Bytes wahrheitsgetreu** an den Adapter (M-2) —
    inklusive der **Ack-Übersetzung** (Payload-Digest ↔ Mediator-
    Queue-ID = sha256 über den qb64-Text);
  - **Delete-to-Ack unter der Hoheit des Adapters**: die 0.12.0-
    Session ackt sonst direkt nach dem Consumer (mit eigenem
    `_seen`-Dedup); die Subclass `RltpMediatorSession` hebt beides
    auf — geackt wird erst, wenn der Adapter `conclude` sagt.
  - `RLTP_WIRE_DEPOSIT` ist ein **Mess-Schalter**, keine Profil-Option
    (beide Seiten einer Probe gleich): `egress` (Default, Profil §1),
    `egress-session` (Egress-Identität authentisiert eine eigene
    ATM-Session und deponiert über deren Socket), `connection`
    (Sender = Connection-DID).
- `live-probe.mjs` — env-gated (`RLTP_LIVE_MEDIATOR=1`): zwei
  Beziehungen gegen die öffentliche Dev-Instanz, deposit → deliver
  → conclude in beide Richtungen.
- `live-delivery-probe.mjs` — der volle Delivery-Vertrag live
  (env-gated wie oben): lib-`seal()` eines echten Delivery-Dokuments
  auf Bobs rkid → Träger-Pfad → gestuftes `receive()`-Verdikt
  (`unique`, Digest) → signierter `delivery-ack/0.1`
  (eddsa-jcs-2022, ref+thread-gebunden) zurück → Alices §6.1-Trias
  schließt `accepted → delivered` (nicht late).
- `.sender-hypothesis.mjs` — Naht-Messung: welchen TSP-Sender leitet
  der Mediator weiter? Drei Fälle (Sender = Socket-DID; fremde
  Sender-VID auf dem Socket; Sender-VID auf eigenem Socket).

## Instanz

`did:webvh:QmR5xGk8pkd3ymu7xpfkjr7XZmwDALA5ZJmgG7qcrD2mKA:webvh.storm.ws:mediator`
(Log-Version 1 vom 27.09.2026), Endpunkte `https://mediator.vtc.storm.ws/mediator/v1`,
`wss://mediator.vtc.storm.ws/mediator/v1/ws`; das DID-Dokument
nennt zusätzlich einen `TSPTransport`-Dienst auf derselben URL.
Die früher konfigurierte DID mit SCID `QmTS3a3H…` löst nicht mehr
auf (`SCID in DID … does not match SCID in log 'QmR5xGk8…'`).

## Messstand 17.10.2026

| Probe | `egress` (Profil) | `egress-session` | `connection` |
|---|---|---|---|
| `live-probe.mjs` | **FAIL** — `no delivery within 20s` | PASS | PASS |
| `live-delivery-probe.mjs` | **FAIL** — `no delivery in 20s` | PASS | PASS |
| `.sender-hypothesis.mjs` | fremde Sender-VID: nicht zugestellt | eigener Socket: zugestellt | Socket-DID: zugestellt |

Rahmengrößen (Rev 3 direkt): 64 B Payload → 393 B, 48 B → 375 B,
681 B versiegeltes Delivery-Dokument → 1008 B, 1224 B Ack → 1551 B.

## Gemessene Betriebsfakten

1. **Der Mediator leitet einen TSP-Rahmen nur weiter, wenn die
   Sender-VID im Envelope die authentisierte DID des Sockets ist.**
   Ein Rahmen mit fremder Sender-VID verschwindet ohne Fehler, ohne
   Problem-Report; gilt für Rev 2 und Rev 3 gleich. Damit trägt der
   Profil-Default (Egress-Identität als Sender auf dem Socket der
   Connection-DID) auf dieser Instanz nicht.
2. Rev 2 und Rev 3 werden beide zugestellt (Sender = Socket-DID);
   die Bindung packt und akzeptiert nur Rev 3.
3. **`register()` ist die Transportzulassung** — erst sie öffnet
   ATM-Session und Pickup-Socket; `collect()` hat keinen eigenen
   Wire-Verkehr. Ein Empfänger, der nie registriert, empfängt nie.
   Scheitert die ATM-Auth (etwa an der DID-Auflösung), meldet der
   Adapter `awaiting-transport(transport-unreachable)`.
4. Der Mediator **routet auf der Envelope-Empfänger-VID**; eine
   Keylist ist für did:key-Clients nicht nötig.
5. `accepted` heißt hier: der Rahmen ging auf den Socket. Ein
   verworfener Rahmen (Fakt 1) ist für den Sender davon nicht
   unterscheidbar; erst der signierte Ack schließt die Trias.
6. M-2 hält live: Zufalls-Envelopes kamen byte-identisch an.

## Ausführen

```sh
cd binding && npm install
RLTP_LIVE_MEDIATOR=1 npm run probe                  # braucht Netz
RLTP_LIVE_MEDIATOR=1 node live-delivery-probe.mjs
RLTP_LIVE_MEDIATOR=1 RLTP_WIRE_DEPOSIT=egress-session npm run probe
RLTP_WIRE_DEBUG=1 ...                               # Rahmengrößen, Dispatch-Fehler
MEDIATOR_DID=... npm run probe                      # andere Instanz
```

Die Proben importieren `../lib/dist`; die lib muss gebaut sein.

## Offen

- Welche Sender-Form das Profil festschreibt (Fakt 1): Egress-Identität
  mit eigener ATM-Session, Connection-DID als Sender, oder Routed-Mode
  (Outer-Hop an den Mediator).
- Routed-Mode und der §5a.10-Peer-Wechsel via Rev-3-Referral
  (vti-tsp-js 0.3.0 dekodiert Referrals, komponiert sie nicht).
- Rev 3 §7.2.2: Endpunkte SOLLEN Anwendungsnachrichten ohne
  TSP-Beziehung (`XRFI`/`XRFA`) verwerfen; die Bindung schickt ohne
  Beziehungs-Handshake, der Mediator verlangt ihn nicht.
- Offline-Signal (`wire.offline()`): der Socket-Zustand ist die
  natürliche Quelle; noch nicht verdrahtet.
