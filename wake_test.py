import pyaudio
import numpy as np
from openwakeword.model import Model

RATE = 16000
CHUNK = 1280

model = Model(
    wakeword_models=["hey_jarvis"],
    inference_framework="onnx",
)

audio = pyaudio.PyAudio()

stream = audio.open(
    format=pyaudio.paInt16,
    channels=1,
    rate=RATE,
    input=True,
    input_device_index=0,
    frames_per_buffer=CHUNK,
)

print("Listening locally... Say: Hey Jarvis")

try:
    while True:
        data = stream.read(CHUNK, exception_on_overflow=False)
        samples = np.frombuffer(data, dtype=np.int16)

        prediction = model.predict(samples)
        score = prediction.get("hey_jarvis", 0)
        print(f"Score: {score:.4f}", end="\r", flush=True)
        if score > 0.5:
            print("WAKE WORD DETECTED!")
            break

finally:
    stream.stop_stream()
    stream.close()
    audio.terminate()
