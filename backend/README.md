# 3SAJ Studio - Extraction API for Render.com

Backend microservice powered by **FastAPI** and **yt-dlp** for resolving social video links (YouTube, TikTok, Bilibili, Facebook, Instagram) into direct downloadable `.mp4` video streams and `.srt` subtitles for the 3SAJ Studio mobile app.

---

## 🚀 1-Click Deployment to Render.com (FREE)

1. **Push this code to GitHub / GitLab**.
2. Go to [https://render.com](https://render.com) and Sign In / Sign Up.
3. Click **"New +"** ➔ Select **"Web Service"**.
4. Connect your GitHub repository.
5. Configure the service:
   - **Name:** `saj-studio-extractor` (or any name you like)
   - **Root Directory:** `backend`
   - **Runtime:** `Python`
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - **Instance Type:** `Free`
6. Click **"Create Web Service"**.
7. Wait 2 minutes for Render to deploy. You will receive an HTTPS URL, e.g.:
   ```
   https://saj-studio-extractor.onrender.com
   ```

---

## 📱 Connect Mobile App to Render

Once deployed, open **3SAJ Studio** on your phone:
1. Tap **Settings** ⚙️.
2. Under **Backend API URL**, enter your Render URL:
   ```
   https://saj-studio-extractor.onrender.com
   ```
3. Tap **Save Settings**.

Now anyone can paste a link from YouTube, TikTok, or Bilibili, and the app will automatically download the video & subtitles and start translating!
