import Foundation
import Speech
import AVFoundation

let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))!
let request = SFSpeechAudioBufferRecognitionRequest()
request.shouldReportPartialResults = true
request.requiresOnDeviceRecognition = true

let audioEngine = AVAudioEngine()
let inputNode = audioEngine.inputNode
let format = inputNode.outputFormat(forBus: 0)

inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
    request.append(buffer)
}

audioEngine.prepare()
try audioEngine.start()

print("Listening... say Hey Tom")

let task = recognizer.recognitionTask(with: request) { result, error in
    if let result = result {
        let text = result.bestTranscription.formattedString.lowercased()
        print(text)
        if text.contains("hey tom") {
            print("WAKE DETECTED")

let process = Process()
process.executableURL = URL(fileURLWithPath: "/Users/tdurg/Tom/.venv/bin/python")
process.arguments = ["/Users/tdurg/Tom/tom.py"]
try? process.run()
process.waitUntilExit()

exit(0)
        }
    }

    if let error = error {
        print("Speech error:", error.localizedDescription)
        exit(1)
    }
}

RunLoop.main.run()
