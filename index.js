const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const express = require("express");
const app = express();
const port = 5000;
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const dotenv = require("dotenv");
dotenv.config();
// const bodyParser = require("body-parser");
// app.use(bodyParser.urlencoded({ extended: true }));
const multer = require("multer");
const multerS3 = require("multer-s3");
const r2 = require("./r2Config");
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
            console.log("Uploading file:", uniqueName);
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

    console.log("Received Token:", token);
    
    if (!token) {
        return res.status(403).json({ error: "Access denied. No token provided." });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: "Invalid or expired token." });
        }
        req.user = user;
        console.log("User authenticated successfully.");
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
        //console.log("Generated Token:", token);
        res.json({token});
    } catch (error) {
        res.json({ error: error.message });
    }
});
app.get("/lost-and-found/items", async (req, res) => {
    try {
        const posts = await prisma.item.findMany();
        const postsWithPublicUrls = posts.map((post) => {
            const imageKey = post.image.split("/").pop(); 
            //console.log("Image Key:", imageKey);
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
app.post("/lost-and-found/post",
    (req, res, next) => {
        console.log("Request Headers:", req.headers);
        console.log("Request Body:", req.body); 
        next();
      },upload.single('image'),authenticateToken, async (req, res) => {
      try {
        console.log("Request Body:", req.body.data);
        console.log("Uploaded File:", req.file); 
        const { item_name, user_name,description,location,contact_number,reason,special_marks } = req.body;
        
        const user_id = req.user.user_id;
        console.log("User ID:", user_id);
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
            special_marks : JSON.parse(special_marks),
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
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});