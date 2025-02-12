import "dotenv/config"; 
import express from "express";
import nodemailer from "nodemailer";
import otpGenerator from "otp-generator";
import redis from "redis";

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());


const redisConnection = redis.createClient({ url: "" });

redisConnection.on("error", (err) => console.error("Redis Connection Error:", err));
redisConnection.connect().then(() => console.log("Connected to Redis"));


const transporter = nodemailer.createTransport({
    service: "gmail",
    host: "smtp.gmail.com",
    port: 465, 
    secure: true, 
    auth: {
        user: process.env.ADMIN_EMAIL,
        pass: process.env.ADMIN_PASS,
    },
});


transporter.verify((error, success) => {
    if (error) {
        console.error("Nodemailer error:", error);
    } else {
        console.log("Nodemailer is Connected");
    }
});


app.post("/send", async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ error: "Email is required" });
    }

    const otp = otpGenerator.generate(6, {
        digits: true,
        lowerCaseAlphabets: false,
        upperCaseAlphabets: false,
        specialChars: false,
    });

    // otp timeout
    await redisConnection.setEx(email, 120, otp);

    const mailOptions = {
        from: process.env.ADMIN_EMAIL,
        to: email,
        subject: "OTP Verification",
        text: `Your OTP code is ${otp}. It is valid for 2 minutes.`,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`OTP Sent to ${email}: ${otp}`);
        res.status(200).json({ message: "OTP sent successfully" });
    } catch (err) {
        console.error("Email Sending Error:", err);
        res.status(500).json({ error: "Failed to send OTP", details: err.message });
    }
});

// Verify OTP
app.post("/verify", async (req, res) => {
    const { otp, email } = req.body;

    if (!email || !otp) {
        return res.status(400).json({ error: "OTP and Email are required" });
    }

    const redisOTP = await redisConnection.get(email);

    if (!redisOTP) {
        return res.status(410).json({ error: "OTP Expired. Please request a new one." });
    }

    if (redisOTP === otp) {
        await redisConnection.del(email);
        console.log(`OTP Verified for ${email}`);
        return res.status(200).json({ message: "OTP verified successfully" });
    }

    return res.status(400).json({ error: "Invalid OTP" });
});


app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
