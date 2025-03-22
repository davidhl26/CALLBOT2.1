import axios from "axios";

export const hangupCall = async (callControlId) => {
  console.log("[Telnyx] Hanging up call");
  let data = JSON.stringify({
    Texml: `
    <Response>
      <Hangup />
    </Response>
    `,
  });

  let config = {
    method: "post",
    maxBodyLength: Infinity,
    url: `https://api.telnyx.com/v2/texml/calls/${callControlId}/update`,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
    },
    data: data,
  };

  try {
    const response = await axios.request(config);
    console.log("[Telnyx] Hangup response:", response.data);
    return response;
  } catch (error) {
    console.error(
      "[Telnyx] Error hanging up call:",
      error.response?.data || error.message
    );
    return null;
  }
};
