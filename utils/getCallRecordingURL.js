import axios from "axios";

export const getCallRecordingURL = async (recordingSid) => {
  try {
    const response = await axios.get(
      `https://api.telnyx.com/v2/recordings/${recordingSid}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log("Recording URL response.data:", response.data);
    return response.data.data.download_urls.mp3;
  } catch (error) {
    console.error("Error fetching recording URL:", error);
    return null;
  }
};
