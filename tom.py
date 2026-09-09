import os
import getpass
import subprocess
import speech_recognition as sr

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

client = OpenAI(
    api_key=os.getenv("OMNIROUTE_API_KEY"),
    base_url=os.getenv("OMNIROUTE_BASE_URL"),
)

saved_passphrase = os.getenv("TOM_PASSPHRASE")

recognizer = sr.Recognizer()
microphone = sr.Microphone(device_index=0)

print("Tom: Authentication required.")
subprocess.run(["say", "Authentication required. State your passphrase."])

with microphone as source:
    audio = recognizer.listen(source, timeout=10, phrase_time_limit=8)

try:
    entered_passphrase = recognizer.recognize_google(audio)
    print("Tom heard:", repr(entered_passphrase))
except sr.UnknownValueError:
    print("Tom: Access denied.")
    subprocess.run(["say", "Access denied."])
    raise SystemExit

spoken_passphrase = entered_passphrase.lower().strip()
spoken_passphrase = spoken_passphrase.replace("at the rate", "@")
spoken_passphrase = spoken_passphrase.replace("at rate", "@")
spoken_passphrase = spoken_passphrase.replace(" at ", "@")
spoken_passphrase = spoken_passphrase.replace(" ", "")

if spoken_passphrase != saved_passphrase.strip().lower().replace(" ", ""):
    print("Tom: Access denied.")
    subprocess.run(["say", "Access denied."])
    raise SystemExit

print("Tom: Authentication confirmed. Welcome, Boss.")
subprocess.run(["say", "Authentication confirmed. Welcome, Boss."])

while True:
    print("Tom: Listening...")

    with microphone as source:
        audio = recognizer.listen(source, timeout=None, phrase_time_limit=10)
    
    try:
        user_input = recognizer.recognize_google(audio)
        print("Boss:", user_input)
    except sr.UnknownValueError:
        print("Tom: I didn't understand that.")
        continue

    command = user_input.lower().strip()

    shutdown_phrases = [
        "exit",
        "quit",
        "stop tom",
        "exit and stop",
        "shutdown tom",
        "shut down tom",
        "close tom",
    ]

    if any(phrase == command for phrase in shutdown_phrases):
        print("Tom: Goodbye, Boss.")
        subprocess.run(["say", "Goodbye, Boss."])
        break

    response = client.chat.completions.create(
        model="auto/best-free",
        messages=[
            {
                "role": "system",
                "content": (
                    "Your name is Tom. You are the user's personal AI assistant. "
                    "The user has successfully authenticated. Address the user as Boss. "
                    "Be concise and direct."
                ),
            },
            {"role": "user", "content": user_input},
        ],
    )

    print("Tom:", response.choices[0].message.content)
    subprocess.run(["say", response.choices[0].message.content])
