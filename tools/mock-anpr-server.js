/* Mock HTTP server for ANPR-config.js
 *
 * It emulates a Hikvision ANPR camera endpoint and returns
 * the same XML payloads used in tools/test-anpr-picname.js.
 *
 * Usage:
 *   node tools/mock-anpr-server.js
 *
 * Environment variables:
 *   MOCK_ANPR_PORT  - TCP port to listen on (default: 18080)
 */

const http = require("http");

// Simple static XML used as a fallback / sanity check
const xml1 = `<?xml version="1.0" encoding="UTF-8"?>
<Plates version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
  <Plate>
    <captureTime>20200424T1616270000</captureTime>
    <plateNumber>DK18HVX</plateNumber>
    <picName>202004241616278800</picName>
    <country>GBR</country>
    <laneNo>1</laneNo>
    <direction>forward</direction>
  </Plate>
</Plates>`;

const PORT = Number(process.env.MOCK_ANPR_PORT || 18080);

// Extract <picTime>...</picTime> from the request body
function extractPicTime(body) {
    if (!body) return null;
    const match = /<picTime>(\d+)<\/picTime>/i.exec(body);
    return match ? match[1] : null;
}

// Generate a fake plateNumber (just to have different values)
function generatePlateNumber(index) {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const l1 = letters[index % letters.length];
    const l2 = letters[(index * 7) % letters.length];
    const l3 = letters[(index * 13) % letters.length];
    const n = (100 + index).toString();
    return `${l1}${l2}${l3}${n}`;
}

// Generate an XML with multiple Plate entries, with picName values strictly
// increasing and in RANDOM ORDER inside the XML, so ANPR-config.js must sort.
function generateMultiPlatesXml(basePicTime, count) {
    try {
        const len = basePicTime.length;
        const base = BigInt(basePicTime);
        const plates = [];

        for (let i = 0; i < count; i++) {
            const increment = BigInt(i + 1) * 100n; // step of 100 on the tail
            let val = base + increment;
            let picNameStr = val.toString();
            if (picNameStr.length < len) {
                picNameStr = picNameStr.padStart(len, "0");
            }

            const plateNumber = generatePlateNumber(i);
            const datePart = basePicTime.substring(0, 8); // YYYYMMDD
            const timePart = basePicTime.substring(8, 14); // HHMMSS
            const captureTime = `${datePart}T${timePart}0000`;

            plates.push(
                `  <Plate>
    <captureTime>${captureTime}</captureTime>
    <plateNumber>${plateNumber}</plateNumber>
    <picName>${picNameStr}</picName>
    <country>GBR</country>
    <laneNo>1</laneNo>
    <direction>forward</direction>
  </Plate>`
            );
        }

        // Shuffle plates to ensure XML order is not sorted
        for (let i = plates.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const tmp = plates[i];
            plates[i] = plates[j];
            plates[j] = tmp;
        }

        return `<?xml version="1.0" encoding="UTF-8"?>
<Plates version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
${plates.join("\n")}
</Plates>`;
    } catch (error) {
        console.error("[mock-anpr] Error generating multi-plates XML:", error.message || error);
        return xml1;
    }
}

function handlePlatesRequest(req, res, body) {
    // Decide which XML to return based on the requested picTime.
    // ANPR-config.js sends:
    //   <AfterTime><picTime>...</picTime></AfterTime>
    const picTime = extractPicTime(body);

    // If we have a valid picTime, generate a list of plates with
    // strictly increasing picName values in random order, so that
    // ANPR-config.js must sort them using sortPlates.
    let responseXml;
    if (picTime) {
        responseXml = generateMultiPlatesXml(picTime, 10);
        console.log(
            `[mock-anpr] Responding with MULTI-PLATES XML (10 items) for picTime ${picTime}`
        );
    } else {
        responseXml = xml1;
        console.log(
            `[mock-anpr] Responding with fallback single plate XML (no picTime found in body)`
        );
    }

    res.writeHead(200, {
        "Content-Type": "application/xml; charset=utf-8"
    });
    res.end(responseXml);
}

const server = http.createServer((req, res) => {
    if (
        req.method === "POST" &&
        req.url.startsWith("/ISAPI/Traffic/channels/1/vehicleDetect/plates")
    ) {
        let body = "";
        req.on("data", (chunk) => {
            body += chunk.toString();
            // Basic protection against overly large bodies in tests
            if (body.length > 1e6) {
                req.socket.destroy();
            }
        });
        req.on("end", () => {
            handlePlatesRequest(req, res, body);
        });
        return;
    }

    // Fallback for other paths
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("mock-anpr-server: not found");
});

server.listen(PORT, () => {
    console.log("============================================================");
    console.log("=== MOCK ANPR SERVER AVVIATO                             ===");
    console.log("=== 1) AVVIA NODE-RED                                    ===");
    console.log(
        "=== 2) CONFIGURA IL NODO ANPR-CONFIG CON QUESTO ENDPOINT ==="
    );
    console.log("===    PROTOCOL: http                                    ===");
    console.log(`===    HOST:     localhost                               ===`);
    console.log(`===    PORT:     ${PORT.toString().padEnd(4, " ")}                             ===`);
    console.log(
        "===    PATH:     /ISAPI/Traffic/channels/1/vehicleDetect/plates ==="
    );
    console.log("============================================================");
    console.log(
        `[mock-anpr] Mock ANPR server listening on http://localhost:${PORT}`
    );
    console.log(
        `[mock-anpr] Endpoint: POST /ISAPI/Traffic/channels/1/vehicleDetect/plates`
    );
    console.log(
        `[mock-anpr] Use this host/port in ANPR-config (protocol=http, no auth required).`
    );
});
