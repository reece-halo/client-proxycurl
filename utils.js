import { promises as fs } from "fs";

export const getAccessToken = async (call) => {
    console.log("Obtaining access token...");
    try {
        const repsonse = await fetch(
            call.url,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: `grant_type=client_credentials&scope=all&client_id=${call.client_id}&client_secret=${call.client_secret}`,
            }
        );

        const data = await repsonse.json();

        return data.access_token;
    } catch (error) {
        console.error("Error with obtaining access token: ", error);
    }
};





/*
    accessToken,
    call: {
        baseUrl: "",
        endpoint: ""
    }
*/

export const apiCaller = async (call, json = true) => {
    let responseCode = null;
    let responseText = null;
    let tryCount = 0;
    const retryLimit = 5;

    do {
        tryCount += 1;
        try {
            const url = new URL(`${call.baseUrl}${call.endpoint}`);

            if (call.params) {
                Object.keys(call.params).forEach(key => url.searchParams.append(key, call.params[key]));
            }

            const response = await fetch(url, {
                    method: call.method,
                    headers: {
                        ...(call.headers?.["Content-Type"] || { "Content-Type": "application/json" }),
                        ...(call.bearerToken && { Authorization: `Bearer ${call.bearerToken}`}),
                        Connection: "keep-alive",
                        ...call.headers
                    },
                    body: json ? JSON.stringify(call.body) : call.body
                }
            );

            responseCode = response.status;
            responseText = response.statusText;

            console.log(`${call.method}: ${call.endpoint} (${responseCode}: ${responseText})`);

            if (responseCode === 429) {
                console.warn("Rate limit reached. Retrying in 1 minute...");
                await new Promise((resolve) => setTimeout(resolve, 60000));
                continue;
            }

            // if (responseCode === 401) {
            //     console.warn("Token needs regenerating");
            //     accessToken.value = await getAccessToken();
            //     continue;
            // }

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            if (json) {
                return await response.json();
            }

            return response;
        } catch (error) {
            console.error("API call failed:", error);

            if (error.code === "ECONNRESET") {
                console.warn("Connection reset. Retrying...");
            }

            if (responseCode != 429 || responseCode != 401) {
                throw error;
            }
        }
    } while ((responseCode === 429 || responseCode === 401) && tryCount < retryLimit);
};

export const logger = async (fileName, message, addSpace, logPlain) => {
    console.log(message);
    try {
        if (logPlain) {
            await fs.appendFile(fileName, "\n" + message);
        } else {
            await fs.appendFile(fileName, (addSpace ? "\n" : "") + "\n" + `${new Date().toISOString()} ${message}`);
        }
    } catch (error) {
        console.log("Error logging:", error);
    }
};