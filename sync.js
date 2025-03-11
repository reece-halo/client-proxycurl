import "dotenv/config";
import { getAccessToken, apiCaller, logger } from "./utils.js";

const HALO_CLIENT_ID = process.env.HALO_CLIENT_ID;
const HALO_CLIENT_SECRET = process.env.HALO_CLIENT_SECRET;

let haloAccessToken = await getAccessToken({
    method: "POST",
    url: `https://halo.haloservicedesk.com/auth/token`,
    scope: "all",
    client_id: HALO_CLIENT_ID,
    client_secret: HALO_CLIENT_SECRET
});

// Get the client list
try {
    const clients = (await apiCaller({
        method: "POST",
        baseUrl: `https://halo.haloservicedesk.com/api`,
        endpoint: "/report",
        bearerToken: haloAccessToken,
        body: [{
            "sql": `
                SELECT
                    aarea AS [Client ID],
                    aareadesc AS [Client],
                    PRODUCT.fvalue AS [Product],
                    CONVERT(NVARCHAR,IIF(Astopped=1,'Stopped','Allowed')) AS [Account Status],
                    AREA.CFProxycurlLastSynced AS [Proxycurl Last Synced],
                    [Main Site].SiteEmailDomain AS [Email Domains]
                FROM
                    AREA
                LEFT JOIN LOOKUP PRODUCT ON AREA.cfproduct = PRODUCT.fcode AND PRODUCT.fid = 161
                LEFT JOIN (
                    SELECT
                        *,
                        ROW_NUMBER() OVER (PARTITION BY SArea ORDER BY SArea ASC) AS [RowNo]
                    FROM
                        Site
                    WHERE
                        SIsInactive = 0
                        AND SIsInvoiceSite = 1
                ) AS [Main Site] ON AArea = SArea AND [RowNo] = 1
                WHERE
                    AREA.AIsInactive = 0
                    AND AREA.Astopped = 0
                    AND PRODUCT.fvalue IN ('HaloITSM', 'HaloCRM')
                    AND CFProxycurlPayload LIKE '%company_size_on_linkedin%'
                    AND CFEmployeesInLinkedIn IS NULL
            `,
            "_loadreportonly": true
        }]
    })).report.rows;

    // Iterate through the clients
    for (let [clientIndex, client] of clients.entries()) {
        await logger("./logs1.txt", `\n(${clientIndex + 1}/${clients.length}) ${client["Client ID"]} ${client.Client}`, null, true);

        const detailedClient = await apiCaller({
            method: "GET",
            baseUrl: `https://halo.haloservicedesk.com/api`,
            endpoint: `/client/${client["Client ID"]}?includedetails=true`,
            bearerToken: haloAccessToken
        });

        const payload = detailedClient.customfields.find(obj => obj.name == "CFProxycurlPayload");
        const payloadObj = JSON.parse(payload.value);

        // Post to Halo
        const body = [
            {
                "isclientdetails": true,
                "id": `${client["Client ID"]}`,
                "customfields": [
                    ...(payloadObj.profile.company_size_on_linkedin
                        ? [{
                            "name": "CFEmployeesInLinkedIn",
                            "value": `${payloadObj.profile.company_size_on_linkedin}`
                          }]
                        : []),
                    ...(payloadObj.url
                        ? [{
                            "name": "CFLinkedInURL",
                            "value": `${payloadObj.url}`
                          }]
                        : [])
                ]
            }
        ];
        try {
            await apiCaller({
                method: "POST",
                baseUrl: `https://halo.haloservicedesk.com/api`,
                endpoint: "/client",
                bearerToken: haloAccessToken,
                body: body
            });
            await logger("./logs1.txt", `Posted to Halo`, null, true);
        } catch (error) {
            await logger("./logs1.txt", `Failed to post to Halo: ${error} Body: ${JSON.stringify(body)}`, null, true);
            continue;
        }
    }

} catch (error) {
    await logger("./logs1.txt", `Unable to load clients: ${error}`);
}
