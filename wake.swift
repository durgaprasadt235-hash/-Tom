import Foundation
import Speech
import AVFoundation

// Exit codes: 0 = wake detected, 1 = no match / recognition failure,
// 2 = permission, availability, or audio setup failure.
// Python owns command processing; this helper never launches another program.
let wakeWord = CommandLine.arguments.dropFirst().first ?? "tom"
let pattern = "(?<!\\w)" + NSRegularExpression.escapedPattern(for: wakeWord) + "(?!\\w)"
let wakeRegex = try NSRegularExpression(pattern: pattern, options: .caseInsensitive)

func fail(_ message: String, code: Int32 = 2) -> Never {
    FileHandle.standardError.write(Data(("[Tom] Apple wake: " + message + "\n").utf8))
    exit(code)
}

// Fail clearly if accidentally launched via the Swift interpreter, whose
// executable does not contain Tom's required privacy purpose strings.
for key in ["NSMicrophoneUsageDescription", "NSSpeechRecognitionUsageDescription"] {
    guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String,
          !value.isEmpty else {
        fail("Missing \(key). Launch through python -m tom.wake to build the configured helper.")
    }
}
// Hardware-free verification of the actual executable's embedded metadata.
if CommandLine.arguments.contains("--check-configuration") {
    print("Tom Wake privacy metadata verified; no permissions requested or microphone accessed.")
    exit(0)
}

// Run the main event loop while Apple's permission callbacks complete.
SFSpeechRecognizer.requestAuthorization { _ in }
while SFSpeechRecognizer.authorizationStatus() == .notDetermined {
    RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.05))
}
guard SFSpeechRecognizer.authorizationStatus() == .authorized else {
    fail("Speech Recognition permission is required in System Settings > Privacy & Security.")
}

AVCaptureDevice.requestAccess(for: .audio) { _ in }
while AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
    RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.05))
}
guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized else {
    fail("Microphone permission is required in System Settings > Privacy & Security.")
}

guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")),
      recognizer.isAvailable else {
    fail("English (US) speech recognition is unavailable.")
}
guard recognizer.supportsOnDeviceRecognition else {
    fail("On-device English (US) recognition is unavailable. No network fallback is used.")
}
let request = SFSpeechAudioBufferRecognitionRequest()
request.shouldReportPartialResults = true
request.requiresOnDeviceRecognition = true
request.contextualStrings = [wakeWord]

let audioEngine = AVAudioEngine()
let inputNode = audioEngine.inputNode
let format = inputNode.outputFormat(forBus: 0)
guard format.sampleRate > 0, format.channelCount > 0 else {
    fail("No usable microphone input.")
}
inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
    request.append(buffer)
}

var outcome: Int32?
var failureMessage: String?
let task = recognizer.recognitionTask(with: request) { result, error in
    guard outcome == nil else { return }
    if let result = result {
        let text = result.bestTranscription.formattedString
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        if wakeRegex.firstMatch(in: text, range: range) != nil {
            outcome = 0
            return
        }
        if result.isFinal {
            outcome = 1
        }
    }

    if let error = error {
        failureMessage = error.localizedDescription
        outcome = 1
    }
}

audioEngine.prepare()
do {
    try audioEngine.start()
} catch {
    inputNode.removeTap(onBus: 0)
    task.cancel()
    fail("Could not start microphone: \(error.localizedDescription)")
}
print("[Tom] Apple wake listener ready — say \(wakeWord).")
fflush(stdout)

// Bound each recognition attempt; continuous mode can start a fresh attempt.
let deadline = Date(timeIntervalSinceNow: 60)
while outcome == nil && Date() < deadline {
    RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.05))
}
audioEngine.stop()
inputNode.removeTap(onBus: 0)
request.endAudio()
task.cancel()
if let message = failureMessage {
    fail(message, code: 1)
}
exit(outcome ?? 1)
