# binding-vti — die Wire-Bindung unter dem Adapter

Die konkrete `MediatorWire`-Implementierung über `@openvtc/vti-didcomm-js`
0.12.0 und `@openvtc/vti-tsp-js` 0.3.0 (TSP **Rev 3**: HPKE-Base,
Außensignatur). **Dev-only** — nie eine Abhängigkeit der
zero-dependency lib; das Profil 0.24 (`spec/adapter-vti-mediator.md` §3a, §7)
benennt genau die Pflichten, die hier wohnen.

## Was hier liegt

- `vti-wire.mjs` — `createVtiWire(cfg)`:
  - leitet die **Wire-Identitäten aus derselben HKDF** ab wie die
    lib (gleiche Präfixe → byte-identische DIDs zum Adapter-Trio;
    gemessen in der Probe);
  - ATM-Auth unter der Connection-DID, ein Pickup-Socket;
  - `deposit(token, bytes, egressDid, mode)` in der Sendeform von
    Profil 0.24 §3a, im Modus, den der Adapter nennt; beide Schichten
    werden bei jedem Versuch neu gepackt (RLTP-VTI-7110), die
    Adressierung kommt aus `depositAddressing` der lib:
    - **`routed`** (Modus jeder Adapter-Instanz ab Konstruktion):
      innen TSP-Rev-3-`direct` Egress-Identität → Connection-DID des
      Partners (HPKE-Base an deren Schlüssel, signiert von der
      Egress-Identität), außen `packRouted` Connection-DID → `C` mit
      Route `[Connection-DID des Partners]`, versiegelt an den
      Schlüssel, den `C`s DID-Dokument zuerst unter `keyAgreement`
      nennt — aufgelöst bei jeder Authentisierung und jeder
      Token-Erneuerung (RLTP-VTI-7120); Versand über die Session der
      Connection-DID. Eine Session je Beziehung und Seite;
    - **`egress-session`** (Rückfall nach der Umschaltung von
      RLTP-VTI-3130): nur die innere Nachricht, über eine
      send-only-Session der Egress-Identität, die erst beim ersten
      Deposit in diesem Modus authentisiert wird und vor jedem Deposit
      geprüft wird (Socket zu oder Token abgelaufen → neu
      authentisieren und verbinden). Send-only heißt hier
      (`SendOnlySession`): der Socket öffnet ohne
      `live-delivery-change` (kein Live Mode), eingehende Rahmen werden
      unbehandelt verworfen, nichts wird geackt. Auch in diesem Modus
      authentisiert der Adapter vor jedem Deposit zuerst die
      Connection-DID (deren Token ist das erste Argument von
      `deposit`); die Egress-Identität authentisiert die Bindung
      selbst;
  - `onDeliver` entpackt den TSP-Rahmen, verlangt Rev 3 und genau das
    Paar (Egress-Identität des Partners → eigene Connection-DID, in
    beiden Modi), und reicht nur bei einer Anwendungsnachricht vom Typ
    `direct` mit nichtleerer Nutzlast die **inneren Payload-Bytes
    wahrheitsgetreu** an den Adapter (M-2, RLTP-VTI-7140).
    Beziehungsrahmen (`XRFI`/`XRFA`/`XRFD`, Referral im Invite),
    Padding, `nested`/`routed` und leere `direct`-Rahmen gehen nie an
    den Adapter: sie werden mit Typ und Sender-VID geloggt und geackt,
    damit sie die Queue nicht blockieren — inklusive der
    **Ack-Übersetzung** (Payload-Digest ↔ Mediator-Queue-ID = sha256
    über den qb64-Text);
  - **Delete-to-Ack unter der Hoheit des Adapters**: die 0.12.0-
    Session ackt sonst direkt nach dem Consumer (mit eigenem
    `_seen`-Dedup); die Subclass `RltpMediatorSession` hebt beides
    auf — geackt wird erst, wenn der Adapter `conclude` sagt;
  - `queueEmpty()` für die Umschaltprüfung (RLTP-VTI-3130): wahr, wenn
    die Session der Connection-DID offen ist, kein empfangener Rahmen
    noch auf dem Weg zum Adapter ist und seit mindestens 1 s weder ein
    TSP-Rahmen kam noch der Socket (neu) geöffnet wurde. Live Delivery
    schiebt beim Öffnen des Sockets, was der Mediator hält; ein ruhiger
    offener Socket gilt daher als leere Queue. Eine Näherung, keine
    Auskunft des Mediators. Ohne `queueEmpty()` schaltet der Adapter
    nie um (geschlossen);
  - `sentFrames()` — Größen der deponierten Rahmen (Nutzlast, innen,
    außen) für die Messungen der Proben;
  - `RLTP_WIRE_DEPOSIT` (oder `cfg.depositMode`) ist ein
    Messschalter: `routed` (Default) folgt dem Modus des Adapters;
    `egress-session` erzwingt den Rückfall für jedes Deposit;
    `egress` (innere Nachricht allein auf dem Socket der
    Connection-DID) und `connection` (Sender = Connection-DID, eine
    Schicht) sind **Kontrollen und nicht profilkonform**
    (RLTP-VTI-1130, RLTP-VTI-3120); beide Seiten einer Probe in einer
    Kontrollform müssen dieselbe Form fahren.
- `test/wire-demux.test.mjs` — offline (`npm test`): echte Wire,
  echte `RltpMediatorSession`, echter Adapter über einem Mediator-
  Double (ATM-HTTP, DID-Auflösung, Socket über `cfg.transport`). Das
  Double leitet einen Rahmen nur weiter, wenn sein Sender die DID des
  Sockets ist; einen an sich adressierten `routed`-Rahmen öffnet es mit
  seinem aktuellen X25519-Schlüssel, nimmt den nächsten Hop und stellt
  die innere Nachricht unverändert zu; `rotate()` wechselt den
  Schlüssel, Rahmen an den alten verschwinden still. Geprüft: XRFI,
  XRFA, `nested`, `routed` und leeres `direct` erreichen den Adapter
  nicht und werden geackt; routed Ende-zu-Ende bytegleich (außen
  Connection-DID → `C`, Route = Connection-DID des Partners, innen
  Egress-Identität); die Adressierung beider Richtungen gegen
  `vectors/vti-routed-addressing.json`; Neubindung (Deposit scheitert,
  `rotate()`, Erneuerung, das Wartende kommt mit dem neuen Schlüssel
  an); Rückfall `egress-session` über die send-only-Session;
  `queueEmpty()`.
- `live-probe.mjs` — env-gated (`RLTP_LIVE_MEDIATOR=1`): zwei
  Beziehungen gegen die öffentliche Dev-Instanz, deposit → deliver
  → conclude in beide Richtungen; gibt Zustellung ja/nein,
  Rahmengrößen (Nutzlast, innen, außen) und die Zeiten
  Einlieferung → `accepted` und → Zustellung (ms) aus.
- `live-delivery-probe.mjs` — der volle Delivery-Vertrag live
  (env-gated wie oben): lib-`seal()` eines echten Delivery-Dokuments
  auf Bobs rkid → Träger-Pfad → gestuftes `receive()`-Verdikt
  (`unique`, Digest) → signierter `delivery-ack/0.1`
  (eddsa-jcs-2022, ref+thread-gebunden) zurück → Alices §6.1-Trias
  schließt `accepted → delivered` (nicht late), und im Default ist
  `routed` danach für die Beziehung bewiesen. Gibt Zustellung,
  Trias, Rahmengrößen und die Zeiten Einlieferung → `accepted`,
  → Zustellung und → Ack (ms) aus. Keine Secrets.
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

## Messstand

| Probe | `routed` (Default) | `egress-session` | `egress` (Kontrolle) | `connection` (Kontrolle) |
|---|---|---|---|---|
| `live-probe.mjs` | PASS (22.10.) | PASS (17.10.) | **FAIL** — `no delivery within 20s` (17.10.) | PASS (17.10.) |
| `live-delivery-probe.mjs` | PASS (22.10.): `accepted → delivered`, nicht late | PASS (17.10.) | **FAIL** — `no delivery in 20s` (17.10.) | PASS (17.10.) |
| `.sender-hypothesis.mjs` | — | eigener Socket: zugestellt | fremde Sender-VID: nicht zugestellt | Socket-DID: zugestellt |

Rahmengrößen (Rev 3 direkt): 64 B Payload → 393 B, 48 B → 375 B,
681 B versiegeltes Delivery-Dokument → 1008 B, 1224 B Ack → 1551 B.

Routed (22.10., je eine Stichprobe): die Routing-Hülle kostet +408 B
je Rahmen (64 B → innen 393 B → außen 801 B; 48 B → 375 B → 783 B;
Delivery-Dokument 681 B → 1008 B → 1416 B; Ack 1222 B → 1551 B →
1959 B). Eine Einlieferung = ein Rahmen auf dem Socket der
Connection-DID, eine Session je Beziehung und Seite. Zeiten:
`accepted` nach 5–15 ms, Zustellung beim Empfänger nach 256–266 ms,
Einlieferung → geprüfter Ack beim Sender 546 ms (zwei Rundreisen über
den Mediator: Dokument hin, Ack zurück).

## Gemessene Betriebsfakten

1. **Der Mediator leitet einen TSP-Rahmen nur weiter, wenn die
   Sender-VID im Envelope die authentisierte DID des Sockets ist.**
   Ein Rahmen mit fremder Sender-VID verschwindet ohne Fehler, ohne
   Problem-Report; gilt für Rev 2 und Rev 3 gleich. Deshalb trägt die
   einschichtige Form `egress` auf dieser Instanz nicht; Profil 0.24
   antwortet mit `routed` (äußerer Sender = Socket-DID) und dem
   Rückfall `egress-session`.
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
RLTP_LIVE_MEDIATOR=1 RLTP_WIRE_DEPOSIT=egress-session npm run probe   # Rückfall erzwungen
RLTP_LIVE_MEDIATOR=1 RLTP_WIRE_DEPOSIT=egress npm run probe   # Kontrolle, nicht profilkonform
npm test                                            # offline: Demux, routed, Neubindung, Rückfall
RLTP_WIRE_DEBUG=1 ...                               # Rahmengrößen, Dispatch-Fehler
MEDIATOR_DID=... npm run probe                      # andere Instanz
```

Die Proben importieren `../lib/dist`; die lib muss gebaut sein.

## Offen

- Live-Rückfall `egress-session` aus dem Adapter heraus (Frist 24 h) und
  Schlüsselrotation des Mediators: nur im Double geprüft.
- Die send-only-Session öffnet seit dieser Fassung ohne
  `live-delivery-change`; ob der Live-Mediator Deposits über einen
  Socket ohne Live Mode annimmt, ist nicht gemessen (die
  `egress-session`-Werte oben stammen aus der Fassung mit Live Mode).
- Der §5a.10-Peer-Wechsel unter unverändertem `C` wird nicht bedient
  (RLTP-VTI-7120, Profil Open Issue 10); vti-tsp-js 0.3.0 dekodiert
  Referrals, komponiert sie nicht.
- Rev 3 §7.2.2: Endpunkte SOLLEN Anwendungsnachrichten ohne
  TSP-Beziehung (`XRFI`/`XRFA`) verwerfen; die Bindung schickt ohne
  Beziehungs-Handshake, der Mediator verlangt ihn nicht; eingehende
  Beziehungsrahmen werden geloggt und verworfen, nicht beantwortet.
- Offline-Signal (`wire.offline()`): der Socket-Zustand ist die
  natürliche Quelle; noch nicht verdrahtet.
- `queueEmpty()` ist eine Näherung über die Ruhe des Sockets; eine
  Auskunft des Mediators (Message Pickup `status-request`) wäre
  genauer.
