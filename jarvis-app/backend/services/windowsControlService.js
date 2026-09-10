const audioService = require('./windows/audioService');
const displayService = require('./windows/displayService');
const powerControlService = require('./windows/powerControlService');
const processService = require('./windows/processService');
const fileService = require('./windows/fileService');
const clipboardService = require('./windows/clipboardService');
const systemMetricsService = require('./windows/systemMetricsService');
const windowTabService = require('./windows/windowTabService');
const whatsappService = require('./windows/whatsappService');
const uiAutomationService = require('./windows/uiAutomationService');
const actionRouterService = require('./core/actionRouterService');

class WindowsControlService {
    constructor() {
        this.audio = audioService;
        this.display = displayService;
        this.power = powerControlService;
        this.process = processService;
        this.file = fileService;
        this.clipboard = clipboardService;
        this.metrics = systemMetricsService;
        this.windowTab = windowTabService;
        this.whatsapp = whatsappService;
        this.uiAutomation = uiAutomationService;

        this.registerActionRouterHandlers();
    }

    registerActionRouterHandlers() {
        // Audio
        actionRouterService.registerAction('audio.set-volume', async (params) => this.audio.setVolume(params.percent));
        actionRouterService.registerAction('audio.adjust-volume', async (params) => this.audio.adjustVolume(params.delta));
        actionRouterService.registerAction('audio.get-volume', async () => this.audio.getVolume());
        actionRouterService.registerAction('audio.toggle-mute', async () => this.audio.toggleMute());

        // Display
        actionRouterService.registerAction('display.set-brightness', async (params) => this.display.setBrightness(params.percent));
        actionRouterService.registerAction('display.adjust-brightness', async (params) => this.display.adjustBrightness(params.delta));
        actionRouterService.registerAction('display.get-brightness', async () => this.display.getBrightness());
        actionRouterService.registerAction('display.screenshot', async (params) => this.display.takeScreenshot(params.destinationDir));

        // Power
        actionRouterService.registerAction('system.get-battery', async () => this.power.getBatteryStatus());
        actionRouterService.registerAction('power.lock', async () => this.power.lockWorkstation());
        actionRouterService.registerAction('power.suspend', async () => this.power.suspendSystem());
        actionRouterService.registerAction('power.shutdown', async () => this.power.shutdownSystem());
        actionRouterService.registerAction('power.restart', async () => this.power.restartSystem());

        // Process
        actionRouterService.registerAction('process.close', async (params) => this.process.closeApplication(params.appName));
        actionRouterService.registerAction('process.kill', async (params) => this.process.killProcess(params.processName || params.pid));
        actionRouterService.registerAction('system.get-top-consumers', async () => this.process.getTopResourceConsumers());

        // Files
        actionRouterService.registerAction('file.search', async (params) => this.file.searchFiles(params.query, params.extension, params.baseDir));
        actionRouterService.registerAction('file.move', async (params) => this.file.moveFile(params.source, params.destination));
        actionRouterService.registerAction('file.copy', async (params) => this.file.copyFile(params.source, params.destination));
        actionRouterService.registerAction('file.rename', async (params) => this.file.renameFile(params.filePath, params.newName));
        actionRouterService.registerAction('file.delete', async (params) => this.file.deleteFile(params.filePath));

        // Clipboard
        actionRouterService.registerAction('clipboard.read', async () => this.clipboard.readClipboard());
        actionRouterService.registerAction('clipboard.write', async (params) => this.clipboard.writeClipboard(params.text));

        // System Metrics
        actionRouterService.registerAction('system.get-disk-space', async () => this.metrics.getDiskSpace());
        actionRouterService.registerAction('system.get-overview', async () => this.metrics.getSystemOverview());

        // Window & Tab Control
        actionRouterService.registerAction('window.minimize', async () => this.windowTab.minimizeActive());
        actionRouterService.registerAction('window.minimize-all', async () => this.windowTab.minimizeAll());
        actionRouterService.registerAction('window.maximize', async () => this.windowTab.maximizeActive());
        actionRouterService.registerAction('window.close', async () => this.windowTab.closeWindow());
        actionRouterService.registerAction('window.next', async () => this.windowTab.nextWindow());
        actionRouterService.registerAction('tab.next', async () => this.windowTab.nextTab());
        actionRouterService.registerAction('tab.prev', async () => this.windowTab.prevTab());
        actionRouterService.registerAction('tab.close', async () => this.windowTab.closeTab());
        actionRouterService.registerAction('tab.new', async () => this.windowTab.newTab());
        actionRouterService.registerAction('tab.go-to', async (params) => this.windowTab.goToTab(params?.index));

        // WhatsApp Messaging
        actionRouterService.registerAction('whatsapp.send', async (params) => this.whatsapp.sendMessage(params?.contact, params?.message));

        // UI Automation
        actionRouterService.registerAction('ui.click', async (params) => this.uiAutomation.clickElement(params?.window, params?.element, params?.options));
        actionRouterService.registerAction('ui.set-text', async (params) => this.uiAutomation.setText(params?.window, params?.element, params?.text, params?.options));
        actionRouterService.registerAction('ui.select-option', async (params) => this.uiAutomation.selectOption(params?.window, params?.option, params?.options));
    }
}

const windowsControlService = new WindowsControlService();
module.exports = windowsControlService;
