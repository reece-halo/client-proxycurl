import "dotenv/config";
import { getAccessToken, apiCaller, logger } from "./utils.js";

const PROXYCURL_API_KEY = process.env.PROXYCURL_API_KEY;
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
                    AREA.CFProxycurlPayload,
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
                    AND (CFProxycurlLastSynced IS NULL OR CFProxycurlLastSynced <= DATEADD(MONTH, -1, GETDATE()))
            `,
            "_loadreportonly": true
        }]
    })).report.rows;

    await logger("./logs.txt", `${clients.length} clients identified`);

    // Iterate through the clients
    for (let [clientIndex, client] of clients.entries()) {
        await logger("./logs.txt", `\n(${clientIndex + 1}/${clients.length}) ${client["Client ID"]} ${client.Client}`, null, true);

        // Split the email domains
        const emailDomains = client["Email Domains"] != "" ? client["Email Domains"].split(",") : [];
        await logger("./logs.txt", `${emailDomains.length} domains found`, null, true);

        let proxycurlResponse;
        if (emailDomains.length > 0) {
            for (let [emailDomainIndex, emailDomain] of emailDomains.entries()) {
                await logger("./logs.txt", `(${emailDomainIndex + 1}/${emailDomains.length}) Searching based on domain: ${emailDomain}`, null, true);

                try {
                    proxycurlResponse = await apiCaller({
                        method: "GET",
                        baseUrl: `https://nubela.co/proxycurl/api`,
                        endpoint: "/linkedin/company/resolve",
                        bearerToken: PROXYCURL_API_KEY,
                        params: {
                            "company_domain": emailDomain,
                            "enrich_profile": "enrich"
                        }
                    });
                    if (!proxycurlResponse.url) {
                        proxycurlResponse = undefined;
                        throw Error("Not found");
                    }
                    await logger("./logs.txt", `Match found using domain`, null, true);
                    break;
                } catch (error) {
                    await logger("./logs.txt", `Proxycurl returned an error response: ${error}`, null, true);
                }
            }
        }

        if (!proxycurlResponse) {
            await logger("./logs.txt", `Unable to find a successful match using domain, attempting to search using name...`, null, true);
            
            try {
                proxycurlResponse = await apiCaller({
                    method: "GET",
                    baseUrl: `https://nubela.co/proxycurl/api`,
                    endpoint: "/linkedin/company/resolve",
                    bearerToken: PROXYCURL_API_KEY,
                    params: {
                        "company_name": client.Client,
                        "enrich_profile": "enrich"
                    }
                });
                if (!proxycurlResponse.url) {
                    proxycurlResponse = undefined;
                    throw Error("Not found");
                }
                await logger("./logs.txt", `Match found using name`, null, true);
            } catch (error) {
                await logger("./logs.txt", `Proxycurl returned an error response: ${error}`, null, true);
            }
        }

        if (!proxycurlResponse) {
            await logger("./logs.txt", `Unable to find a successful match using domain or name`, null, true);
            proxycurlResponse = {
                error: "Unable to find a successful match using domain or name",
                profile: {
                    company_size: []
                }
            }
        }

        // Post to Halo
        const body = [
            {
                "isclientdetails": true,
                "id": `${client["Client ID"]}`,
                "customfields": [
                    ...(proxycurlResponse.profile.company_size[0]
                        ? [{
                            "name": "CFLinkedInCompanySizeUpper",
                            "value": `${proxycurlResponse.profile.company_size[0]}`
                          }]
                        : []),
                    ...(proxycurlResponse.profile.company_size[1]
                        ? [{
                            "name": "CFLinkedInCompanySizeUpper",
                            "value": `${proxycurlResponse.profile.company_size[1]}`
                          }]
                        : []),
                    {
                        "name": "CFProxycurlPayload",
                        "value": `${JSON.stringify(proxycurlResponse)}`
                    },
                    {
                        "name": "CFProxycurlLastSynced",
                        "value": new Date().toISOString()
                    }
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
            await logger("./logs.txt", `Posted to Halo`, null, true);
        } catch (error) {
            await logger("./logs.txt", `Failed to post to Halo: ${error} Body: ${JSON.stringify(body)}`, null, true);
            continue;
        }
    }

} catch (error) {
    await logger("./logs.txt", `Unable to load clients: ${error}`);
}
