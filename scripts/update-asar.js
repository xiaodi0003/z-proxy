const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Copy directory recursively
function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Remove directory recursively
function removeDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function updateAsar() {
  const asarPath = path.join(__dirname, '../dist/mac/z-proxy.app/Contents/Resources/app.asar');
  const tempDir = path.join(__dirname, '../temp-asar');
  
  if (!fs.existsSync(asarPath)) {
    console.error('\n❌ Base package not found!');
    console.error('Please run: yarn build-package\n');
    process.exit(1);
  }
  
  const buildSrc = path.join(__dirname, '../build');
  const serverSrc = path.join(__dirname, '../server');
  
  if (!fs.existsSync(buildSrc)) {
    console.error('\n❌ Build directory not found!');
    console.error('Please run: yarn build:vue\n');
    process.exit(1);
  }
  
  try {
    // Extract asar
    console.log('📦 Extracting asar...');
    removeDir(tempDir);
    execSync(`npx asar extract "${asarPath}" "${tempDir}"`, { stdio: 'inherit' });
    
    // Update build files
    console.log('🔄 Updating build files...');
    const buildDest = path.join(tempDir, 'build');
    removeDir(buildDest);
    copyDir(buildSrc, buildDest);
    
    // Update server files
    console.log('🔄 Updating server files...');
    const serverDest = path.join(tempDir, 'server');
    removeDir(serverDest);
    copyDir(serverSrc, serverDest);
    
    // Repack asar
    console.log('📦 Repacking asar...');
    execSync(`npx asar pack "${tempDir}" "${asarPath}"`, { stdio: 'inherit' });
    
    // Cleanup
    removeDir(tempDir);
    
    console.log('\n✅ Package updated successfully!');
    console.log(`📦 App location: ${path.join(__dirname, '../dist/mac/z-proxy.app')}`);
    console.log('💡 You can now run the app directly from the dist folder.\n');
  } catch (error) {
    console.error('\n❌ Update failed:', error.message);
    removeDir(tempDir);
    process.exit(1);
  }
}

updateAsar();
