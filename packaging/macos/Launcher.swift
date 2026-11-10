import AppKit

// The native shell owns the Go process, so quitting the app also stops the server.
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var server: Process?
    private var output = Pipe()
    private var serverURL: URL?
    private var log = ""
    private var quitting = false
    private var signals: [DispatchSourceSignal] = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu = NSMenu()
        let item = NSMenuItem()
        menu.addItem(item)
        let applicationMenu = NSMenu()
        item.submenu = applicationMenu
        for (title, action, key) in [
            ("Открыть табло", #selector(openBoard), "o"),
            ("Открыть папку сохранений", #selector(openData), ""),
            ("Завершить Until Morning", #selector(quit), "q")
        ] {
            let command = NSMenuItem(title: title, action: action, keyEquivalent: key)
            command.target = self
            applicationMenu.addItem(command)
        }
        NSApp.mainMenu = menu
        for number in [SIGTERM, SIGINT] {
            signal(number, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
            source.setEventHandler { NSApp.terminate(nil) }
            source.resume()
            signals.append(source)
        }
        guard let executable = Bundle.main.executableURL?.deletingLastPathComponent()
            .appendingPathComponent("until-morning-server") else {
            fail("Не найден сервер приложения.")
            return
        }
        let process = Process()
        process.executableURL = executable
        process.standardOutput = output
        process.standardError = output
        process.standardInput = FileHandle.nullDevice
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.log = String((self.log + text).suffix(8192))
                if let match = self.log.range(of: #"Until Morning: (http://[^\s]+)"#, options: .regularExpression) {
                    self.serverURL = URL(string: String(self.log[match]).replacingOccurrences(of: "Until Morning: ", with: ""))
                }
            }
        }
        process.terminationHandler = { [weak self] process in
            DispatchQueue.main.async {
                guard let self = self, !self.quitting else { return }
                if process.terminationStatus != 0 { self.fail(self.log) }
                else { NSApp.terminate(nil) }
            }
        }
        server = process
        do { try process.run() }
        catch { fail(error.localizedDescription) }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        openBoard()
        return false
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let process = server, process.isRunning else { return .terminateNow }
        quitting = true
        process.terminate()
        DispatchQueue.global().asyncAfter(deadline: .now() + 7) {
            if process.isRunning { kill(process.processIdentifier, SIGKILL) }
        }
        process.waitUntilExit()
        return .terminateNow
    }

    @objc private func openBoard() {
        if let url = serverURL { NSWorkspace.shared.open(url) }
    }

    @objc private func openData() {
        let explicit = ProcessInfo.processInfo.environment["DATA_DIR"] ?? ""
        let directory = explicit.isEmpty
            ? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Until Morning")
            : URL(fileURLWithPath: explicit, isDirectory: true)
        // Resolve/migration happens in Go before any UI creates the directory.
        if FileManager.default.fileExists(atPath: directory.path) {
            NSWorkspace.shared.open(directory)
        } else if serverURL != nil {
            do {
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                NSWorkspace.shared.open(directory)
            } catch { fail(error.localizedDescription) }
        }
    }

    @objc private func quit() { NSApp.terminate(nil) }

    private func fail(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "Не удалось запустить Until Morning"
        alert.informativeText = message.isEmpty ? "Возможно, приложение уже запущено или порт 8080 занят." : message
        alert.alertStyle = .critical
        alert.addButton(withTitle: "Закрыть")
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
        NSApp.terminate(nil)
    }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()
