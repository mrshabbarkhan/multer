// Required packages
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const sharp = require("sharp"); // Add sharp for image processing

const app = express();

// Create uploads directory structure if it doesn't exist
const UPLOAD_BASE_DIR = path.join(__dirname, "uploads");
const UPLOAD_DIRS = {
  original: path.join(UPLOAD_BASE_DIR, "original"),
  thumbnail: path.join(UPLOAD_BASE_DIR, "thumbnail"),
  medium: path.join(UPLOAD_BASE_DIR, "medium"),
  temp: path.join(UPLOAD_BASE_DIR, "temp"),
};

// Create directories if they don't exist
Object.values(UPLOAD_DIRS).forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Configure Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIRS.temp);
  },
  filename: (req, file, cb) => {
    // Generate random name to prevent overwriting and name collision
    const randomName = crypto.randomBytes(16).toString("hex");
    const fileExt = path.extname(file.originalname).toLowerCase();
    cb(null, `${randomName}${fileExt}`);
  },
});

// File filter function to validate uploaded files
const fileFilter = (req, file, cb) => {
  // Accept only image files with specific extensions
  const allowedMimeTypes = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        "Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed."
      ),
      false
    );
  }
};

// Initialize multer with our configuration
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB file size limit
    files: 5, // Maximum 5 files at once
  },
});

// Simple file info database (in production, use a real database)
const fileDatabase = [];

// Middleware for handling multer errors
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res
        .status(400)
        .json({ error: "File too large. Maximum size is 5MB." });
    }
    if (err.code === "LIMIT_FILE_COUNT") {
      return res
        .status(400)
        .json({ error: "Too many files. Maximum is 5 files." });
    }
    return res.status(400).json({ error: err.message });
  }
  next(err);
};

// Process image function - now using sharp for actual processing
async function processImage(originalPath, filename) {
  try {
    // Create thumbnail (200x200)
    const thumbnailPath = path.join(UPLOAD_DIRS.thumbnail, filename);
    await sharp(originalPath)
      .resize(200, 200, { fit: "cover" })
      .toFile(thumbnailPath);

    // Create medium version (800x800 max)
    const mediumPath = path.join(UPLOAD_DIRS.medium, filename);
    await sharp(originalPath)
      .resize(800, 800, { fit: "inside", withoutEnlargement: true })
      .toFile(mediumPath);

    return {
      original: `/images/original/${filename}`,
      thumbnail: `/images/thumbnail/${filename}`,
      medium: `/images/medium/${filename}`,
    };
  } catch (error) {
    console.error("Error processing image:", error);
    throw error;
  }
}

// Endpoint for uploading a single image
app.post(
  "/api/upload/single",
  upload.single("image"),
  handleMulterError,
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No image uploaded" });
      }

      // Move file from temp to original directory
      const originalFilePath = path.join(
        UPLOAD_DIRS.original,
        req.file.filename
      );
      fs.renameSync(req.file.path, originalFilePath);

      // Process image with sharp
      const imagePaths = await processImage(
        originalFilePath,
        req.file.filename
      );

      // Store file information (in production, save to a database)
      const fileInfo = {
        id: crypto.randomBytes(8).toString("hex"),
        originalName: req.file.originalname,
        filename: req.file.filename,
        mimetype: req.file.mimetype,
        size: req.file.size,
        uploaded: new Date(),
        paths: imagePaths,
      };

      fileDatabase.push(fileInfo);

      // Return the file information to client
      return res.status(201).json({
        message: "Image uploaded successfully",
        file: fileInfo,
      });
    } catch (error) {
      console.error("Upload error:", error);
      return res
        .status(500)
        .json({ error: "Error processing the uploaded file" });
    }
  }
);

// Endpoint for uploading multiple images
app.post(
  "/api/upload/multiple",
  upload.array("images", 5),
  handleMulterError,
  async (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: "No images uploaded" });
      }

      const uploadedFiles = [];

      // Process each uploaded file
      for (const file of req.files) {
        // Move file from temp to original directory
        const originalFilePath = path.join(UPLOAD_DIRS.original, file.filename);
        fs.renameSync(file.path, originalFilePath);

        // Process image with sharp
        const imagePaths = await processImage(originalFilePath, file.filename);

        // Store file information
        const fileInfo = {
          id: crypto.randomBytes(8).toString("hex"),
          originalName: file.originalname,
          filename: file.filename,
          mimetype: file.mimetype,
          size: file.size,
          uploaded: new Date(),
          paths: imagePaths,
        };

        fileDatabase.push(fileInfo);
        uploadedFiles.push(fileInfo);
      }

      // Return the files information to client
      return res.status(201).json({
        message: `${uploadedFiles.length} images uploaded successfully`,
        files: uploadedFiles,
      });
    } catch (error) {
      console.error("Upload error:", error);
      return res
        .status(500)
        .json({ error: "Error processing the uploaded files" });
    }
  }
);

// Serve static files
app.use("/images", express.static(UPLOAD_BASE_DIR));

// Get all images endpoint
app.get("/api/images", (req, res) => {
  return res.json(fileDatabase);
});

// Get file by ID endpoint
app.get("/api/images/:id", (req, res) => {
  const fileInfo = fileDatabase.find((file) => file.id === req.params.id);

  if (!fileInfo) {
    return res.status(404).json({ error: "Image not found" });
  }

  return res.json(fileInfo);
});

// Delete file by ID endpoint
app.delete("/api/images/:id", (req, res) => {
  const fileIndex = fileDatabase.findIndex((file) => file.id === req.params.id);

  if (fileIndex === -1) {
    return res.status(404).json({ error: "Image not found" });
  }

  const fileInfo = fileDatabase[fileIndex];

  // Delete the files from disk with error handling for each file
  const filesToDelete = [
    path.join(UPLOAD_DIRS.original, fileInfo.filename),
    path.join(UPLOAD_DIRS.thumbnail, fileInfo.filename),
    path.join(UPLOAD_DIRS.medium, fileInfo.filename),
  ];

  let deletionErrors = false;

  filesToDelete.forEach((filePath) => {
    try {
      // Check if file exists before attempting to delete
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      console.error(
        `Warning: Could not delete file ${filePath}:`,
        error.message
      );
      deletionErrors = true;
      // Continue with other files - don't stop the process
    }
  });

  // Remove from our "database" regardless of file deletion status
  fileDatabase.splice(fileIndex, 1);

  if (deletionErrors) {
    return res.status(200).json({
      message:
        "Image record deleted but some files could not be removed from disk. They will be cleaned up later.",
      partialSuccess: true,
    });
  }

  return res.json({ message: "Image deleted successfully" });
});

// Basic HTML page to test file uploads
app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Image Upload Test</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        form { margin-bottom: 30px; }
        .image-grid { display: flex; flex-wrap: wrap; gap: 15px; }
        .image-card { border: 1px solid #ddd; padding: 10px; border-radius: 5px; width: 220px; }
        .image-card img { max-width: 200px; max-height: 200px; }
        button { padding: 8px 16px; background: #4CAF50; color: white; border: none; cursor: pointer; }
        input[type="file"] { margin: 10px 0; }
      </style>
    </head>
    <body>
      <h1>Image Upload Test</h1>
      
      <h2>Single Image Upload</h2>
      <form id="singleUploadForm" enctype="multipart/form-data">
        <input type="file" name="image" id="singleImage" accept="image/*">
        <button type="submit">Upload</button>
      </form>
      
      <h2>Multiple Image Upload</h2>
      <form id="multipleUploadForm" enctype="multipart/form-data">
        <input type="file" name="images" id="multipleImages" accept="image/*" multiple>
        <button type="submit">Upload All</button>
      </form>
      
      <h2>Uploaded Images</h2>
      <button id="loadImages">Load Images</button>
      <div id="imageGallery" class="image-grid"></div>
      
      <script>
        // Single upload form handler
        document.getElementById('singleUploadForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          const formData = new FormData();
          const fileInput = document.getElementById('singleImage');
          
          if (fileInput.files.length === 0) {
            alert('Please select a file');
            return;
          }
          
          formData.append('image', fileInput.files[0]);
          
          try {
            const response = await fetch('/api/upload/single', {
              method: 'POST',
              body: formData
            });
            
            const result = await response.json();
            if (response.ok) {
              alert('Upload successful');
              loadImages();
            } else {
              alert('Error: ' + result.error);
            }
          } catch (error) {
            console.error('Upload error:', error);
            alert('Upload failed');
          }
        });
        
        // Multiple upload form handler
        document.getElementById('multipleUploadForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          const formData = new FormData();
          const fileInput = document.getElementById('multipleImages');
          
          if (fileInput.files.length === 0) {
            alert('Please select at least one file');
            return;
          }
          
          for (const file of fileInput.files) {
            formData.append('images', file);
          }
          
          try {
            const response = await fetch('/api/upload/multiple', {
              method: 'POST',
              body: formData
            });
            
            const result = await response.json();
            if (response.ok) {
              alert('Uploaded ' + result.files.length + ' images successfully');
              loadImages();
            } else {
              alert('Error: ' + result.error);
            }
          } catch (error) {
            console.error('Upload error:', error);
            alert('Upload failed');
          }
        });
        
        // Load images button handler
        document.getElementById('loadImages').addEventListener('click', loadImages);
        
        // Function to load and display all images
        async function loadImages() {
          try {
            const response = await fetch('/api/images');
            const images = await response.json();
            console.log(images)
            const gallery = document.getElementById('imageGallery');
            gallery.innerHTML = '';
            
            images.forEach(image => {
              const card = document.createElement('div');
              card.className = 'image-card';
              
              const img = document.createElement('img');
              img.src = image.paths.thumbnail;
              img.alt = image.originalName;
              
              const info = document.createElement('div');
              info.innerHTML = \`
                <p><strong>Name:</strong> \${image.originalName}</p>
                <p><strong>Size:</strong> \${Math.round(image.size / 1024)} KB</p>
                <a href="\${image.paths.original}" target="_blank">View Original</a>
                <br>
                <button class="delete-btn" data-id="\${image.id}">Delete</button>
              \`;
              
              card.appendChild(img);
              card.appendChild(info);
              gallery.appendChild(card);
            });
            
            // Add delete button event listeners
            document.querySelectorAll('.delete-btn').forEach(button => {
              button.addEventListener('click', async (e) => {
                const id = e.target.getAttribute('data-id');
                if (confirm('Are you sure you want to delete this image?')) {
                  try {
                    const response = await fetch(\`/api/images/\${id}\`, {
                      method: 'DELETE'
                    });
                    
                    if (response.ok) {
                      alert('Image deleted');
                      loadImages();
                    } else {
                      const result = await response.json();
                      alert('Error: ' + result.error);
                    }
                  } catch (error) {
                    console.error('Delete error:', error);
                    alert('Delete failed');
                  }
                }
              });
            });
          } catch (error) {
            console.error('Error loading images:', error);
            alert('Failed to load images');
          }
        }
        
        // Load images on page load
        loadImages();
      </script>
    </body>
    </html>
  `);
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Server error" });
});

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(
    `Open http://localhost:${PORT} in your browser to test image uploads`
  );
});
