const AnyProxy = require('anyproxy');
const { exec } = require('child_process');
const os = require('os');

const platform = os.platform();
const isWindows = platform === 'win32';
const isMac = platform === 'darwin';

/**
 * Check if root CA exists
 * @returns {boolean} true if certificate exists
 */
function checkCertificateExists() {
  try {
    return AnyProxy.utils.certMgr.isRootCAFileExists();
  } catch (error) {
    console.error('Error checking certificate:', error);
    return false;
  }
}

/**
 * Check if root CA is trusted by system using platform-specific commands
 * @returns {Promise<boolean>} true if certificate is trusted
 */
async function checkCertificateTrustedBySystem() {
  return new Promise((resolve) => {
    const certPath = AnyProxy.utils.certMgr.getRootCAFilePath();
    
    if (isMac) {
      // Use macOS security command to verify certificate trust
      const cmd = `security verify-cert -c "${certPath}" 2>&1`;
      
      exec(cmd, (error, stdout, stderr) => {
        // If verify-cert returns 0, certificate is trusted
        // If it returns non-zero, certificate is not trusted or not found
        const isTrusted = !error;
        console.log(`Certificate trust check (system): ${isTrusted}`);
        resolve(isTrusted);
      });
    } else if (isWindows) {
      // Windows: Check if certificate is in Trusted Root store
      // Use the certificate's subject name to search
      const cmd = `certutil -verifystore Root AnyProxy 2>&1`;
      
      exec(cmd, (error, stdout, stderr) => {
        // If certutil finds the certificate, stdout will contain certificate info
        // Check for both command success and certificate presence in output
        const isTrusted = !error || (stdout && stdout.toLowerCase().includes('anyproxy'));
        console.log(`Certificate trust check (system): ${isTrusted}`);
        resolve(isTrusted);
      });
    } else {
      // Unsupported platform, assume not trusted
      console.log('Certificate trust check not supported on this platform');
      resolve(false);
    }
  });
}

/**
 * Check if root CA is trusted by system (combined check)
 * @returns {Promise<boolean>} true if certificate is trusted
 */
async function checkCertificateTrusted() {
  return new Promise(async (resolve) => {
    // First check using AnyProxy's method
    AnyProxy.utils.certMgr.ifRootCATrusted(async (error, trusted) => {
      if (error) {
        console.error('Error checking certificate trust status:', error);
        resolve(false);
        return;
      }
      
      console.log(`Certificate trust check (AnyProxy): ${trusted}`);
      
      // If AnyProxy says it's trusted, double-check with system command
      if (trusted) {
        const systemTrusted = await checkCertificateTrustedBySystem();
        resolve(systemTrusted);
      } else {
        // If AnyProxy says not trusted, also verify with system command
        // to avoid false negatives
        const systemTrusted = await checkCertificateTrustedBySystem();
        resolve(systemTrusted);
      }
    });
  });
}

/**
 * Show dialog to guide user to trust certificate
 */
async function showTrustGuideDialog() {
  try {
    const { dialog } = require('electron');

    const macInstructions =
      '证书安装窗口已打开，请按照以下步骤操作：\n\n' +
      '1. 在弹出的窗口中点击"添加"按钮\n' +
      '2. 输入您的系统密码确认\n' +
      '3. 打开"钥匙串访问"应用\n' +
      '4. 在"登录"或"系统"钥匙串中找到 "AnyProxy" 证书\n' +
      '5. 双击该证书打开详情\n' +
      '6. 展开"信任"部分\n' +
      '7. 将"使用此证书时"设置为"始终信任"\n' +
      '8. 关闭窗口并输入密码确认';

    const windowsInstructions =
      '证书安装窗口已打开，请按照以下步骤操作：\n\n' +
      '1. 在证书导入向导中，选择"将所有的证书都放入下列存储"\n' +
      '2. 点击"浏览"按钮\n' +
      '3. 选择"受信任的根证书颁发机构"\n' +
      '4. 点击"确定"完成导入\n' +
      '5. 如果出现安全警告，点击"是"确认';

    await dialog.showMessageBox({
      type: 'info',
      title: '需要信任证书',
      message: 'HTTPS 代理需要您信任根证书',
      detail: isWindows ? windowsInstructions : macInstructions,
      buttons: ['我知道了']
    });
  } catch (error) {
    console.error('Failed to show dialog:', error);
  }
}

/**
 * Open certificate file for user to install
 */
function openCertificateForInstall() {
  const certPath = AnyProxy.utils.certMgr.getRootCAFilePath();
  
  let cmd;
  if (isMac) {
    cmd = `open "${certPath}"`;
  } else if (isWindows) {
    // Windows: Use cmd /c start to properly handle paths with spaces
    // The empty "" is the window title parameter for start command
    cmd = `cmd /c start "" "${certPath}"`;
  } else {
    // Linux: Try xdg-open
    cmd = `xdg-open "${certPath}"`;
  }

  exec(cmd, (error) => {
    if (error) {
      console.error('Failed to open certificate:', error);
    } else {
      console.log('Certificate opened for installation');
      showTrustGuideDialog();
    }
  });
}

/**
 * Generate certificate if not exists
 * @returns {Promise<boolean>} true if certificate is ready
 */
async function ensureCertificate() {
  if (checkCertificateExists()) {
    console.log('Certificate already exists');
    
    // Check if trusted (non-blocking)
    checkCertificateTrusted().then((trusted) => {
      if (!trusted) {
        console.log('Certificate not trusted, opening for installation...');
        openCertificateForInstall();
      }
    });
    
    return true;
  }

  console.log('Certificate not found, generating...');

  return new Promise((resolve) => {
    AnyProxy.utils.certMgr.generateRootCA((error) => {
      if (error) {
        console.error('Failed to generate certificate:', error);
        resolve(false);
        return;
      }

      console.log('Certificate generated successfully');
      
      // Open certificate for user to install (non-blocking)
      setTimeout(() => {
        openCertificateForInstall();
      }, 1000);

      resolve(true);
    });
  });
}

module.exports = {
  checkCertificateExists,
  ensureCertificate
};
