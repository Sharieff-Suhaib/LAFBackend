const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const express = require("express");
const app = express();
const port = 5000;
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const dotenv = require("dotenv");
dotenv.config();
const multer = require("multer");
const multerS3 = require("multer-s3");
const r2 = require("./r2Config");
const { DeleteObjectCommand } = require("@aws-sdk/client-s3");
const nodemailer = require("nodemailer");
const otpGenerator = require("otp-generator");
const redis = require("redis");
const cors = require("cors");
app.use(cors());
const upload = multer({
    storage: multerS3({
        s3: r2,
        bucket: "lost-and-found", 
        acl: "public-read",
        contentType: multerS3.AUTO_CONTENT_TYPE,
        key: function (req, file, cb) {
            const uniqueName = `${Date.now()}-${file.originalname}`;
            cb(null, uniqueName);
        },
    }),
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/register", express.json());
app.use("/login", express.json());

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers["authorization"];
    const token = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : authHeader;
    if (!token) {
        return res.status(403).json({ error: "Access denied. No token provided." });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: "Invalid or expired token." });
        }
        req.user = user;
        next();
    });
};

app.post("/register", async (req, res) => {
    try{
        const { email_id, user_name, password, phone_number } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const existingUser = await prisma.user.findUnique({
            where: { email_id },
        });
        if (existingUser) {
            return res.status(400).json({ error: "Email ID already exists. Please use a different email." });
        }
        const user = await prisma.user.create({
            data: {
            email_id,
            user_name,
            password: hashedPassword,
            phone_number,
            },
        });
        res.json(user);
    } catch (error) {
        res.json({ error: error.message });
    }
    
});
app.post("/login", async (req, res) => {
    try {
        const { email_id, password } = req.body;
        const user = await prisma.user.findUnique({
            where: { email_id },
        });
        if (!user) {
            return res.status(400).json({ error: "Invalid email or password" });
        }
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(400).json({ error: "Invalid email or password" });
        }
        const token = jwt.sign({ email_id: user.email_id, user_id: user.user_id }, process.env.JWT_SECRET , { expiresIn: "1h" });
        res.json({token,user_id : user.user_id});
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
});
app.patch("/profile", authenticateToken, async (req, res) => {
  try{
    const { user_id } = req.user;
    const { user_name, email_id, phone_number } = req.body;
    const user = await prisma.user.update({
        where: { user_id },
        data: {
            user_name,
            email_id,
            phone_number,
        },
    });
    res.json(user);
  } catch (error) {
    res.json({ error: error.message });

  }
});
app.get("/lost-and-found/items", async (req, res) => {
    try {
        const posts = await prisma.item.findMany();
        const postsWithPublicUrls = posts.map((post) => {
            const imageKey = post.image.split("/").pop(); 
            const publicUrl = `${process.env.IMAGE_ENDPOINT}/${imageKey}`; 
            return {
              ...post,
              image: publicUrl, 
            };
        });
        res.json(postsWithPublicUrls);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.get("/lost-and-found/items/:userId", authenticateToken, async (req, res) => {
  try {
      const user_id = Number(req.params.userId);

      const posts = await prisma.item.findMany({
          where: { user_id },
      });

      if (!posts || posts.length === 0) {
        return res.json([]);
      }

      const postsWithPublicUrls = posts.map((post) => ({
          ...post,
          image: post.image ? `${process.env.IMAGE_ENDPOINT}/${post.image.split("/").pop()}` : "",
      }));

      res.json(postsWithPublicUrls);
  } catch (error) {
      res.status(500).json({ error: error.message });
  }
});

app.post("/lost-and-found/post",
    (req, res, next) => {
        next();
      },upload.single('image'),authenticateToken, async (req, res) => {
      try { 
        const { item_name, user_name,description,location,contact_number,reason,special_marks } = req.body;
        
        const user_id = req.user.user_id;
        const image_url = req.file?.location;
  
        if (!image_url) {
          return res.status(400).json({ error: "Image upload failed" });
        }
  
        const post = await prisma.item.create({
          data: {
            item_name,
            user_name,
            description,
            location,
            image: image_url,
            contact_number,
            reason,
            special_marks,
            user_id,
          },
        });
        res.json(post);
      } catch (error) {
        console.error("Error:", error);
        res.status(500).json({ error: error.message });
      }
    }
  );

  app.delete("/lost-and-found/delete/:itemId", authenticateToken, async (req, res) => {
    try {
      const item_id = parseInt(req.params.itemId);
  
      if (!item_id) {
        return res.status(400).json({ error: "item_id is required" });
      }
  
      const item = await prisma.item.findUnique({
        where: { item_id },
      });
      if (!item) {
        return res.status(404).json({ error: "Item not found" });
      }
      if (item.image) {
        const urlParts = item.image.split('/');
        const fileKey = urlParts[urlParts.length - 1].split('?')[0];
  
        const params = {
          Bucket: "lost-and-found",
          Key: fileKey,
        };
        const deleteCommand = new DeleteObjectCommand(params);
        const response = await r2.send(deleteCommand);
      }
  
      await prisma.itemReceived.create({
        data: {
          item_id: item_id,
          item_name: item.item_name,
          user_id : item.user_id,
          received_at: new Date(),
        },
      });
      await prisma.item.delete({
        where: { item_id },
      });
  
      res.json({ message: "Item and its image successfully deleted and recorded." });
    } catch (error) {
      console.error("Error deleting item:", error);
      res.status(500).json({ error: error.message });
    }
  });
app.get("/profile", authenticateToken, async (req, res) => {
  try{
    if (!req.user || !req.user.user_id) {
      return res.status(401).json({ error: "Unauthorized access" });
    }
    const { user_id } = req.user;
    const user = await prisma.user.findUnique({
        where: { user_id },
    });
    res.json(user);
  } catch (error) {
    res.json({ error: error.message });

  } 
});

// const redisConnection = redis.createClient({ url: "redis://localhost:6379" });

// redisConnection.on("error", (err) => console.error("Redis Connection Error:", err));
// redisConnection.connect().then(() => console.log("Connected to Redis"));


// const transporter = nodemailer.createTransport({
//     service: "gmail",
//     host: "smtp.gmail.com",
//     port: 465, 
//     secure: true, 
//     auth: {
//         user: process.env.ADMIN_EMAIL,
//         pass: process.env.ADMIN_PASS,
//     },
// });


// transporter.verify((error, success) => {
//     if (error) {
//         console.error("Nodemailer error:", error);
//     } else {
//         console.log("Nodemailer is Connected");
//     }
// });


// app.post("/send", async (req, res) => {
//     const { email } = req.body;

//     if (!email) {
//         return res.status(400).json({ error: "Email is required" });
//     }

//     const otp = otpGenerator.generate(6, {
//         digits: true,
//         lowerCaseAlphabets: false,
//         upperCaseAlphabets: false,
//         specialChars: false,
//     });

    
//     await redisConnection.setEx(email, 120, otp);

//     const mailOptions = {
//         from: process.env.ADMIN_EMAIL,
//         to: email,
//         subject: "OTP Verification",
//         text: `Your OTP code is ${otp}. It is valid for 2 minutes.`,
//     };

//     try {
//         await transporter.sendMail(mailOptions);
//         res.status(200).json({ message: "OTP sent successfully" });
//     } catch (err) {
//         console.error("Email Sending Error:", err);
//         res.status(500).json({ error: "Failed to send OTP", details: err.message });
//     }
// });

// app.post("/verify", async (req, res) => {
//     const { otp, email } = req.body;

//     if (!email || !otp) {
//         return res.status(400).json({ error: "OTP and Email are required" });
//     }

//     const redisOTP = await redisConnection.get(email);

//     if (!redisOTP) {
//         return res.status(410).json({ error: "OTP Expired. Please request a new one." });
//     }

//     if (redisOTP === otp) {
//         await redisConnection.del(email);
//         return res.status(200).json({ message: "OTP verified successfully" });
//     }

//     return res.status(400).json({ error: "Invalid OTP" });
// });
const otpStorage = {}; // In-memory OTP storage

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

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

// Send OTP API
app.post("/send", async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ error: "Email is required" });
    }

    const otp = generateOTP();

    // Store OTP in memory with a timestamp
    otpStorage[email] = { otp, expiresAt: Date.now() + 2 * 60 * 1000 }; // 2 minutes

    const mailOptions = {
        from: process.env.ADMIN_EMAIL,
        to: email,
        subject: "OTP Verification",
        text: `Your OTP code is ${otp}. It is valid for 2 minutes.`,
    };

    try {
        await transporter.sendMail(mailOptions);
        res.status(200).json({ message: "OTP sent successfully" });
    } catch (err) {
        console.error("Email Sending Error:", err);
        res.status(500).json({ error: "Failed to send OTP", details: err.message });
    }
});

// Verify OTP API
app.post("/verify", (req, res) => {
    const { otp, email } = req.body;

    if (!email || !otp) {
        return res.status(400).json({ error: "OTP and Email are required" });
    }

    const storedOTP = otpStorage[email];

    if (!storedOTP) {
        return res.status(410).json({ error: "OTP Expired. Please request a new one." });
    }

    if (Date.now() > storedOTP.expiresAt) {
        delete otpStorage[email]; // Remove expired OTP
        return res.status(410).json({ error: "OTP Expired. Please request a new one." });
    }

    if (storedOTP.otp === otp) {
        delete otpStorage[email]; // Remove OTP after successful verification
        return res.status(200).json({ message: "OTP verified successfully" });
    }

    return res.status(400).json({ error: "Invalid OTP" });
});
app.post("/change-password", authenticateToken, async (req, res) => {
  try {
      const { new_password, conf_password } = req.body;
      if (!new_password || !conf_password) {
        return res.status(400).json({ error: "Both password fields are required" });
    }

    if (new_password !== conf_password) {
        return res.status(400).json({ error: "Passwords do not match" });
    }

      const hashedPassword = await bcrypt.hash(new_password, 10);
      await prisma.user.update({
          where: { user_id: req.user.user_id },
          data: { password: hashedPassword },
      });

      res.status(200).json({ message: "Password changed successfully" });
  } catch (error) {
      res.status(500).json({ error: "Internal Server Error" });
  }
});
app.get("/logout", (req, res) => {
  try {
    res.status(200).json({ message: "Logout successful" });
  } catch (error) {
    res.status(500).json({ error: "Failed to logout" });
  }
});
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});