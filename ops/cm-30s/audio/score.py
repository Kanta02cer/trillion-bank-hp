#!/usr/bin/env python3
"""Original score + sound design for the Trillion Bank 30s CM.

Everything is synthesised here (no samples, no third-party audio), so the
soundtrack carries no external rights. 120 BPM, D minor -> D major ending.
Sync points come from out/cues.json (exported by `node render.mjs --cues`)
and from the scene timings in cm.html.

  python3 audio/score.py            -> out/score.wav (48 kHz / 24-bit, -14 LUFS, <= -1 dBTP)
  python3 audio/score.py --plot     -> also out/score.png (spectrogram for review)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from scipy import signal
import pyloudnorm as pyln

HERE = Path(__file__).resolve().parents[1]
OUT = HERE / "out"
SR = 48000
DUR = 30.0
N = int(SR * DUR)
BEAT = 0.5
rng = np.random.default_rng(20261017)
CUES = json.loads((OUT / "cues.json").read_text())


# ---------------------------------------------------------------- utilities
def mtof(m: float) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


def tt(n: int) -> np.ndarray:
    return np.arange(n) / SR


def noise(n: int) -> np.ndarray:
    return rng.standard_normal(n)


def sos_filter(x, kind, f, order=2):
    wn = np.asarray(f, dtype=float) / (SR / 2)
    sos = signal.butter(order, wn if wn.ndim else float(wn), btype=kind, output="sos")
    return signal.sosfilt(sos, x)


def lp(x, f, o=2): return sos_filter(x, "lowpass", min(f, SR / 2 - 100), o)
def hp(x, f, o=2): return sos_filter(x, "highpass", f, o)
def bp(x, a, b, o=2): return sos_filter(x, "bandpass", [a, min(b, SR / 2 - 100)], o)


def sweep_bp(x, f0, f1, q=1.6, block=256, curve=None):
    """Band-pass with a time-varying centre (log interpolation), block-wise."""
    out = np.zeros_like(x)
    zi = None
    nb = int(np.ceil(len(x) / block))
    for b in range(nb):
        u = b / max(1, nb - 1)
        if curve is not None:
            u = curve(u)
        fc = f0 * (f1 / f0) ** u
        lo, hi = fc / (1 + 1 / (2 * q)), min(fc * (1 + 1 / (2 * q)), SR / 2 - 200)
        sos = signal.butter(2, [lo / (SR / 2), hi / (SR / 2)], btype="bandpass", output="sos")
        if zi is None:
            zi = np.zeros((sos.shape[0], 2))
        seg = x[b * block:(b + 1) * block]
        y, zi = signal.sosfilt(sos, seg, zi=zi)
        out[b * block:b * block + len(seg)] = y
    return out


def fade(x, a=0.003, r=0.01):
    n = len(x)
    na, nr = min(n, int(a * SR)), min(n, int(r * SR))
    if na:
        x[:na] *= np.linspace(0, 1, na)
    if nr:
        x[n - nr:] *= np.linspace(1, 0, nr)
    return x


def stereo(x, pan=0.0):
    th = (np.clip(pan, -1, 1) + 1) * np.pi / 4
    return np.stack([x * np.cos(th), x * np.sin(th)]) * np.sqrt(2)


class Bus:
    def __init__(self, name):
        self.name = name
        self.x = np.zeros((2, N))

    def add(self, sig, t0, gain=1.0, pan=0.0):
        if sig.ndim == 1:
            sig = stereo(sig, pan)
        i0 = int(round(t0 * SR))
        if i0 >= N:
            return
        s0 = max(0, -i0)
        i0 = max(0, i0)
        n = min(sig.shape[1] - s0, N - i0)
        if n > 0:
            self.x[:, i0:i0 + n] += sig[:, s0:s0 + n] * gain


def saw_add(f, n, bright=None, maxh=60, det=0.0, phase=0.0):
    """Band-limited saw by additive synthesis; `bright` (scalar/array) sets harmonic roll-off."""
    t = tt(n)
    f = f * 2 ** (det / 1200)
    H = int(min(maxh, (SR / 2 - 1000) / f))
    out = np.zeros(n)
    for k in range(1, H + 1):
        a = 1.0 / k
        if bright is not None:
            a = a * np.exp(-(k - 1) / bright)
        out += a * np.sin(2 * np.pi * k * f * t + phase * k)
    return out


def adsr(n, a=0.005, d=0.1, s=0.7, r=0.1):
    e = np.ones(n) * s
    na, nd, nr = int(a * SR), int(d * SR), int(r * SR)
    na = min(na, n)
    e[:na] = np.linspace(0, 1, na) if na else e[:na]
    nd = min(nd, n - na)
    if nd > 0:
        e[na:na + nd] = np.linspace(1, s, nd)
    nr = min(nr, n)
    if nr:
        e[n - nr:] *= np.linspace(1, 0, nr)
    return e


# -------------------------------------------------------------- instruments
def kick(dur=0.45, f0=46, f1=165, decay=7.5, click=1.0):
    n = int(dur * SR); t = tt(n)
    f = f0 + (f1 - f0) * np.exp(-t * 40)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * decay)
    c = hp(noise(n), 2500) * np.exp(-t * 320) * 0.22 * click
    return fade(np.tanh((body + c) * 1.8) / np.tanh(1.8), 0.0005, 0.02)


def clap(dur=0.35):
    n = int(dur * SR); t = tt(n)
    x = np.zeros(n)
    nz = bp(noise(n), 900, 3200)
    for d in (0.0, 0.011, 0.023):
        i = int(d * SR)
        x[i:] += nz[: n - i] * np.exp(-t[: n - i] * 140)
    x += nz * np.exp(-t * 16) * 0.55
    x += np.sin(2 * np.pi * 210 * t) * np.exp(-t * 35) * 0.3
    return fade(x * 0.6, 0.0005, 0.03)


def hat(open_=False):
    dur = 0.2 if open_ else 0.06
    n = int(dur * SR); t = tt(n)
    x = bp(noise(n), 7000, 15000) * np.exp(-t * (16 if open_ else 75))
    return fade(x, 0.0003, 0.01)


def snare(dur=0.22):
    n = int(dur * SR); t = tt(n)
    body = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 28) * 0.6 + np.sin(2 * np.pi * 330 * t) * np.exp(-t * 45) * 0.25
    nz = bp(noise(n), 1500, 9000) * np.exp(-t * 24)
    return fade(body + nz * 0.8, 0.0005, 0.02)


def bass(m, dur, b0=7.0, b1=2.2, tau=0.07, sub=0.75):
    n = int(dur * SR); t = tt(n)
    f = mtof(m)
    br = b1 + (b0 - b1) * np.exp(-t / tau)
    x = saw_add(f, n, br, maxh=36) * 0.55 + np.sin(2 * np.pi * f * t) * sub
    return fade(x * adsr(n, 0.004, 0.12, 0.8, 0.03), 0.003, 0.03)


def pluck(m, dur=0.32, b0=16, b1=1.6, tau=0.05, dec=7.0):
    n = int(dur * SR); t = tt(n)
    f = mtof(m)
    br = b1 + (b0 - b1) * np.exp(-t / tau)
    x = saw_add(f, n, br, maxh=40, det=-4) * 0.5 + saw_add(f, n, br, maxh=40, det=5) * 0.5
    return fade(x * np.exp(-t * dec), 0.002, 0.03)


def pad(ms, dur, att=0.5, rel=0.9, bright=4.0, lfo=0.25, det=9, width=0.7):
    n = int(dur * SR); t = tt(n)
    L = np.zeros(n); R = np.zeros(n)
    br = bright * (1 + 0.25 * np.sin(2 * np.pi * lfo * t))
    for j, m in enumerate(ms):
        f = mtof(m)
        for k, d in enumerate((-det, 0, det)):
            v = saw_add(f, n, br, maxh=30, det=d + j * 0.7, phase=rng.uniform(0, 6.28))
            pn = (k - 1) * width
            g = stereo(v, pn)
            L += g[0]; R += g[1]
    e = adsr(n, att, 0.3, 1.0, rel)
    return np.stack([L, R]) * e / (3 * len(ms))


def stab(ms, dur=0.9, bright=9.0):
    n = int(dur * SR); t = tt(n)
    br = 2 + bright * np.exp(-t / 0.12)
    L = np.zeros(n); R = np.zeros(n)
    for j, m in enumerate(ms + [ms[0] + 12]):
        for k, d in enumerate((-7, 0, 7)):
            v = saw_add(mtof(m), n, br, maxh=40, det=d)
            g = stereo(v, (k - 1) * 0.8)
            L += g[0]; R += g[1]
    e = np.exp(-t * 3.2) * adsr(n, 0.004, 0.01, 1, 0.08)
    return np.stack([L, R]) * e / (3 * (len(ms) + 1))


def bell(m, dur=2.6, amp=1.0):
    n = int(dur * SR); t = tt(n)
    f = mtof(m)
    x = np.zeros(n)
    for r, a, d in ((1, 1, 1.7), (2.0, 0.55, 1.2), (2.76, 0.4, 2.0), (4.07, 0.22, 0.9), (5.43, 0.14, 0.6), (8.9, 0.06, 0.35)):
        if f * r < SR / 2 - 1000:
            x += a * np.sin(2 * np.pi * f * r * t) * np.exp(-t * (1 / d) * 1.4)
    return fade(x * amp * 0.45, 0.001, 0.05)


def blip(m, dur=0.16, bend=0.8, dec=26):
    n = int(dur * SR); t = tt(n)
    f0 = mtof(m)
    f = f0 * (bend + (1 - bend) * (1 - np.exp(-t * 220)))
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = (np.sin(ph) + 0.25 * np.sin(2 * ph) + 0.08 * np.sin(3 * ph)) * np.exp(-t * dec)
    return fade(x * 0.8, 0.0008, 0.02)


def tick(f=4500, dur=0.012):
    n = int(dur * SR); t = tt(n)
    return fade(bp(noise(n), f * 0.7, f * 1.4) * np.exp(-t * 600), 0.0002, 0.003)


def whoosh(dur, f0=300, f1=4000, peak=0.6, q=1.1):
    n = int(dur * SR); u = np.linspace(0, 1, n)
    env = np.where(u < peak, (u / peak) ** 2, ((1 - u) / (1 - peak)) ** 1.5)
    x = sweep_bp(noise(n), f0, f1, q=q) * env
    return fade(x / (np.abs(x).max() + 1e-9), 0.002, 0.02)


def riser(dur, f0=180, f1=900):
    n = int(dur * SR); t = tt(n); u = t / dur
    nz = sweep_bp(noise(n), 500, 9000, q=0.8, curve=lambda v: v ** 1.6) * u ** 2.2
    f = f0 * (f1 / f0) ** (u ** 1.4)
    ph = 2 * np.pi * np.cumsum(f * (1 + 0.004 * np.sin(2 * np.pi * 6 * t))) / SR
    tone = sum(np.sin(ph * k) / k for k in range(1, 7)) * u ** 2.5
    x = nz / (np.abs(nz).max() + 1e-9) * 0.8 + lp(tone, 4000) * 0.35
    return fade(x, 0.01, 0.004)


def rev_cymbal(dur):
    n = int(dur * SR); u = np.linspace(0, 1, n)
    x = bp(noise(n), 3500, 14000) * u ** 3.2
    return fade(x / (np.abs(x).max() + 1e-9), 0.01, 0.003)


def impact(dur=2.2, size=1.0):
    n = int(dur * SR); t = tt(n)
    k = np.zeros(n); kk = kick(0.8, 38, 140, 4.0, 1.4); k[: len(kk)] = kk
    f = 55 * np.exp(-t * 1.8) + 30
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.0) * 0.9
    crash = lp(noise(n), 7000) * np.exp(-t * 3.0) * 0.35 * size
    crash = hp(crash, 300)
    return fade(np.tanh((k + sub + crash) * 1.3), 0.0005, 0.1)


def thud(f0=120, f1=48, dec=9):
    n = int(0.5 * SR); t = tt(n)
    f = f1 + (f0 - f1) * np.exp(-t * 30)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * dec) + lp(noise(n), 1200) * np.exp(-t * 40) * 0.3
    return fade(np.tanh(x * 1.5), 0.0005, 0.03)


def zap(f0=2400, f1=600, dur=0.07):
    n = int(dur * SR); t = tt(n); u = t / dur
    f = f0 * (f1 / f0) ** u
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.6 + bp(noise(n), 2000, 7000) * 0.4
    return fade(x * np.exp(-t * 40), 0.0005, 0.01)


def glitch_grain(dur=1 / 30):
    n = int(dur * SR); t = tt(n)
    f = rng.choice([110, 220, 330, 440, 880])
    sq = np.sign(np.sin(2 * np.pi * f * t))
    x = sq * 0.5 + noise(n) * 0.6
    hold = rng.integers(6, 24)
    x = np.repeat(x[::hold], hold)[:n]
    x = np.round(x * 6) / 6
    return fade(x, 0.0005, 0.002)


def pop(dur=0.22):
    n = int(dur * SR); t = tt(n)
    f = 380 + 700 * (1 - np.exp(-t * 45)) + 40 * np.sin(2 * np.pi * 18 * t) * np.exp(-t * 12)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return fade((np.sin(ph) + 0.2 * np.sin(2 * ph)) * np.exp(-t * 16), 0.001, 0.02)


# --------------------------------------------------------------- arrangement
drums, bassb, music, sfx, hall_send, room_send = (Bus(n) for n in ("drums", "bass", "music", "sfx", "hall", "room"))
kick_times: list[float] = []


def K(t, g=0.85, **kw):
    drums.add(kick(**kw), t, g)
    kick_times.append(t)
    room_send.add(kick(), t, 0.08)


# chord map (MIDI): pad voicing, bass root
CH = {
    "Dm": ([57, 62, 65, 69], 38), "Bb": ([58, 62, 65, 70], 34), "F": ([57, 60, 65, 69], 41),
    "C": ([55, 60, 64, 67], 36), "Gm": ([55, 58, 62, 67], 31), "A": ([57, 61, 64, 69], 33),
    "D": ([62, 66, 69, 76], 38),
}
PROG = [(0.0, 2.5, "Dm"), (2.5, 4.0, "Bb"), (4.0, 6.0, "Dm"), (6.0, 8.0, "Bb"), (8.0, 10.0, "F"), (10.0, 12.0, "C"),
        (12.0, 14.3, "Dm"), (14.3, 16.0, "Gm"), (16.0, 18.25, "Bb"), (18.25, 20.0, "F"),
        (20.0, 21.0, "Dm"), (21.0, 22.0, "Bb"), (22.0, 23.0, "C"), (23.0, 23.74, "A"), (24.0, 30.0, "D")]


def chord_at(t):
    for a, b, c in PROG:
        if a <= t < b:
            return c
    return None


# --- pads
for a, b, c in PROG:
    ms, _ = CH[c]
    if a < 4.0:
        p = pad([m - 12 for m in ms[:3]], b - a + 0.8, att=0.9 if a == 0 else 0.3, rel=0.8, bright=2.2)
        music.add(p, a, 0.2); hall_send.add(p, a, 0.12)
    elif a < 20.0:
        br = 3.2 if a < 14.3 else 2.0
        g = 0.52 if a < 14.3 else 0.5
        if a == 16.0:  # breath before the super: hold through
            p = pad(ms, b - a + 0.9, att=0.08, rel=0.9, bright=br)
        else:
            p = pad(ms, b - a + 0.6, att=0.12, rel=0.6, bright=br if a != 18.25 else 4.5)
        music.add(p, a, g); hall_send.add(p, a, 0.2)
    elif a >= 24.0:
        p = pad(ms + [81, 86], 6.0, att=0.25, rel=2.6, bright=3.4, width=0.9)
        music.add(p, a, 0.5); hall_send.add(p, a, 0.45)

# --- intro: drone, ticking tension, hits
drone_n = int(4.1 * SR); t_d = tt(drone_n)
drone = (saw_add(mtof(26), drone_n, 1.5 + 2.5 * (t_d / 4.1) ** 2, maxh=30) + saw_add(mtof(33), drone_n, 1.2 + 2 * (t_d / 4.1) ** 2, maxh=30) * 0.6)
drone = fade(drone * np.minimum(1, t_d / 0.6), 0.01, 0.15)
music.add(drone, 0.0, 0.075)
sfx.add(impact(2.4, 0.4), 0.02, 0.35); hall_send.add(impact(2.4, 0.4), 0.02, 0.25)
w = whoosh(1.0, 200, 3000, 0.55)
sfx.add(stereo(w, -0.6) * np.linspace(1, 0.4, len(w)) + stereo(w, 0.6) * np.linspace(0.4, 1, len(w)), 0.02, 0.22)
for k in range(int((3.72 - 0.75) / 0.25)):
    t0 = 0.75 + k * 0.25
    sfx.add(tick(6000, 0.02), t0, 0.07 + 0.08 * (t0 / 3.7), pan=0.3 if k % 2 else -0.3)
for k in range(12):
    sfx.add(tick(7000, 0.015), 3.0 + k * 0.0625, 0.12, pan=0.2)
sfx.add(whoosh(0.5, 2000, 500, 0.3), 0.6, 0.08)
K(2.5, 0.55, f0=40, f1=120, decay=4.5); hall_send.add(kick(0.6, 40, 120, 4.5), 2.5, 0.25)
music.add(pluck(50, 1.2, 6, 1.5, 0.1, 2.5), 2.5, 0.25)
for g in CUES["glitch"]:
    sfx.add(glitch_grain(), g, 0.22, pan=float(rng.uniform(-0.6, 0.6)))
sfx.add(riser(1.25, 160, 900), 2.75, 0.28)
sfx.add(rev_cymbal(1.0), 3.0, 0.2)

# --- big moments
for t0, sz, g in ((4.0, 1.0, 1.0), (14.5, 0.8, 0.9), (18.25, 0.7, 0.75), (20.0, 1.0, 1.0), (24.0, 0.6, 0.6)):
    im = impact(2.4, sz)
    sfx.add(im, t0, g); hall_send.add(im, t0, 0.32 * g)
    kick_times.append(t0)

# --- drums
def grid(a, b, step):
    return [round(a + i * step, 6) for i in range(int(round((b - a) / step)))]


for t0 in grid(4.0, 17.85, BEAT) + grid(18.5, 20.0, BEAT) + grid(20.0, 23.74, BEAT):
    if t0 in (4.0, 14.5, 20.0):
        continue
    K(t0, 0.66 if t0 < 14.3 or t0 >= 20 else 0.6)
for t0 in grid(4.0, 17.85, 1.0) + grid(20.0, 23.74, 1.0):
    drums.add(clap(), t0 + 0.5, 0.42); hall_send.add(clap(), t0 + 0.5, 0.12)
for t0 in grid(4.0, 17.85, BEAT) + grid(20.0, 23.74, BEAT):
    drums.add(hat(True), t0 + 0.25, 0.14, pan=0.25)
for t0 in grid(8.0, 17.85, 0.125) + grid(20.0, 23.74, 0.125):
    if abs((t0 / 0.25) - round(t0 / 0.25)) > 1e-6:
        drums.add(hat(), t0, 0.06 + (0.03 if t0 > 14.5 else 0), pan=-0.3)
# rolls into the verbs and into the tagline
for k, t0 in enumerate(grid(19.0, 19.5, 0.125) + grid(19.5, 20.0, 0.0625)):
    drums.add(snare(), t0, 0.12 + 0.3 * (t0 - 19.0), pan=0.0)
sfx.add(riser(1.0, 220, 1100), 19.0, 0.3)
for t0 in grid(23.5, 23.74, 0.0625):
    drums.add(snare(), t0, 0.3)
sfx.add(rev_cymbal(0.26), 23.74, 0.25)

# --- bass
for t0 in grid(4.0, 14.3, BEAT):
    c = chord_at(t0)
    bassb.add(bass(CH[c][1], 0.22), t0 + 0.25, 0.3)
for t0 in grid(14.5, 17.85, 0.125):
    c = chord_at(t0)
    m = CH[c][1] + (12 if int(round(t0 / 0.125)) % 4 == 2 else 0)
    bassb.add(bass(m, 0.11, b0=4.5, b1=1.6, tau=0.04), t0, 0.27)
for t0 in grid(18.25, 20.0, 0.25):
    bassb.add(bass(CH["F"][1], 0.2, b0=5, b1=2), t0, 0.26)
for t0 in grid(20.0, 23.74, 0.25):
    bassb.add(bass(CH[chord_at(t0)][1], 0.2, b0=6, b1=2.4), t0, 0.3)
sub_n = int(5.6 * SR); t_s = tt(sub_n)
bassb.add(fade(np.sin(2 * np.pi * mtof(38) * t_s) * np.exp(-t_s * 0.35), 0.01, 1.2), 24.0, 0.3)

# --- arps
ARP = [0, 1, 2, 3, 2, 1, 3, 2]
for t0 in grid(4.0, 14.3, 0.125):
    ms, _ = CH[chord_at(t0)]
    i = int(round((t0 - 4.0) / 0.125))
    m = ms[ARP[i % 8]] + 12 + (12 if i % 16 == 15 else 0)
    g = 0.18 if t0 >= 5.0 else 0.18 * (t0 - 4.0)
    music.add(pluck(m, 0.3), t0, g, pan=0.35 if i % 2 else -0.35)
for t0 in grid(14.5, 17.85, 0.125):
    ms, _ = CH[chord_at(t0)]
    i = int(round((t0 - 14.5) / 0.125))
    music.add(pluck(ms[ARP[i % 8]], 0.22, 7, 1.3, 0.04, 9), t0, 0.17, pan=0.4 if i % 2 else -0.4)
for t0 in grid(18.25, 20.0, 0.125):
    ms, _ = CH["F"]
    i = int(round((t0 - 18.25) / 0.125))
    music.add(pluck(ms[ARP[i % 8]] + 12, 0.3, 20, 2, 0.06), t0, 0.12 + 0.08 * (t0 - 18.25), pan=0.35 if i % 2 else -0.35)
for k, t0 in enumerate(grid(24.4, 29.0, 0.25)):
    ms, _ = CH["D"]
    m = [74, 78, 81, 88, 86, 81, 78, 81][k % 8]
    g = 0.07 * min(1.0, (t0 - 24.4) / 0.8) * max(0.0, min(1.0, (29.0 - t0) / 1.5))
    music.add(pluck(m, 0.5, 12, 2, 0.08, 4.5), t0, g, pan=0.5 if k % 2 else -0.5)

# --- verbs: stabs on each hit
for t0, c in ((20.0, "Dm"), (21.0, "Bb"), (22.0, "C"), (23.0, "A")):
    s = stab(CH[c][0], 0.95)
    music.add(s, t0, 0.8); hall_send.add(s, t0, 0.3)
    if t0 > 20.0:
        im = impact(1.4, 0.5); sfx.add(im, t0, 0.6); hall_send.add(im, t0, 0.15)
        kick_times.append(t0)

# --- S2: words + whip
sfx.add(whoosh(0.35, 3000, 900, 0.3), 5.08, 0.1)
sfx.add(whoosh(0.4, 600, 5000, 0.6), 5.25, 0.12)
sfx.add(whoosh(0.25, 2500, 8000, 0.5), 5.78, 0.08, pan=-0.3)
sfx.add(whoosh(0.25, 2500, 8000, 0.5), 6.05, 0.08, pan=0.3)
w = whoosh(0.55, 250, 5000, 0.62)
sfx.add(stereo(w, 0.8) * np.linspace(1, 0.2, len(w)) + stereo(w, -0.8) * np.linspace(0.2, 1, len(w)), 6.55, 0.35)
sfx.add(thud(160, 60, 12), 7.0, 0.3)

# --- S3: AirReach Consulting
for k, t0 in enumerate(CUES["answer"]):
    if k % 2 == 0:
        sfx.add(tick(float(rng.uniform(3500, 6000)), 0.01), t0, 0.06, pan=float(rng.uniform(-0.3, 0.3)))
sc = whoosh(0.56, 500, 7000, 0.8, q=2.5)
sfx.add(sc, 7.98, 0.1); sfx.add(blip(93, 0.1), 7.98, 0.06)
sfx.add(blip(86, 0.12), 8.12, 0.1, pan=-0.2); sfx.add(blip(89, 0.12), 8.2, 0.1, pan=0.2)
for t0, m in ((8.0, 77), (8.5, 81), (9.0, 84), (9.5, 89)):
    b = blip(m, 0.2, 0.7, 18); sfx.add(b, t0, 0.18, pan=0.4); hall_send.add(b, t0, 0.12)
sfx.add(thud(180, 80, 14), 9.55, 0.4)
sfx.add(tick(2500, 0.03), 9.56, 0.15)
sfx.add(whoosh(0.6, 400, 3000, 0.5), 9.98, 0.14)
for i in range(4):
    sfx.add(tick(3000 + i * 400, 0.02), 10.3 + i * 0.09, 0.07, pan=0.2 + i * 0.15)
for i, m in enumerate((72, 76, 79, 84, 88)):
    b = blip(m, 0.16); sfx.add(b, 10.6 + i * 0.14, 0.12, pan=-0.6 + i * 0.3); hall_send.add(b, 10.6 + i * 0.14, 0.1)
sw = whoosh(0.5, 300, 2000, 0.85); sfx.add(sw, 10.95, 0.12)

# --- S4: AirReach Tools
w = whoosh(0.5, 300, 6000, 0.55)
sfx.add(stereo(w, -0.8) * np.linspace(1, 0.2, len(w)) + stereo(w, 0.8) * np.linspace(0.2, 1, len(w)), 12.38, 0.3)
sfx.add(thud(140, 60, 13), 12.63, 0.25)
for t0 in CUES["url"]:
    sfx.add(tick(float(rng.uniform(2500, 4500)), 0.014), t0, 0.1, pan=0.4)
sfx.add(tick(1800, 0.03), 13.22, 0.3, pan=0.4); sfx.add(blip(84, 0.08), 13.24, 0.08, pan=0.4)
rn = int(0.7 * SR); t_r = tt(rn); fr = 520 * (3.0 ** (t_r / 0.7) ** 0.8)
ring = np.sin(2 * np.pi * np.cumsum(fr) / SR) * (0.4 + 0.6 * (t_r / 0.7)) * (1 + 0.3 * np.sin(2 * np.pi * 14 * t_r))
sfx.add(fade(ring, 0.02, 0.05), 13.32, 0.07, pan=0.4)
for m, d in ((86, 0.0), (93, 0.07)):
    b = bell(m, 1.2, 0.8); sfx.add(b, 14.0 + d, 0.22, pan=0.4); hall_send.add(b, 14.0 + d, 0.2)
sfx.add(whoosh(0.35, 800, 3500, 0.5), 13.6, 0.08, pan=0.5)

# --- S5: Adctor
for i, t0 in enumerate((14.5, 14.55, 14.6)):
    sfx.add(thud(110 - i * 12, 45, 8), t0, 0.45, pan=(-0.5, 0, 0.5)[i])
w = whoosh(0.5, 3000, 500, 0.4)
sfx.add(w, 14.62, 0.15)
for i in range(3):
    z = zap(3200, 900, 0.12); sfx.add(z, 14.7 + i * 0.1, 0.12, pan=-0.4 + i * 0.4); hall_send.add(z, 14.7 + i * 0.1, 0.15)
hum_n = int(0.7 * SR); t_h = tt(hum_n)
hum = lp(saw_add(mtof(43), hum_n, 3 + 6 * t_h / 0.7, maxh=40), 3000) * np.sin(np.pi * t_h / 0.7)
sfx.add(fade(hum, 0.02, 0.05), 14.9, 0.12)
for g in CUES["gates"]:
    z = zap(2600 + 300 * g["panel"], 700, 0.06)
    sfx.add(z, g["t"], 0.07, pan=-0.3 + 0.3 * g["panel"])
for i, t0 in enumerate(CUES["receipts"]):
    b = blip(91 + (i % 3) * 2, 0.08, 0.95, 40); sfx.add(b, t0, 0.1, pan=0.6)
    sfx.add(tick(5000, 0.012), t0 + 0.03, 0.08, pan=0.6)
for i, (t0, m) in enumerate(zip((15.25, 15.8, 16.35, 16.9, 17.45), (67, 70, 74, 77, 79))):
    b = blip(m, 0.22, 0.75, 14); sfx.add(b, t0, 0.15, pan=-0.6 + i * 0.3); hall_send.add(b, t0, 0.12)
sfx.add(whoosh(0.45, 400, 3000, 0.7), 17.85, 0.12)
for m in (77, 81, 84):
    b = bell(m, 2.4, 0.7); music.add(b, 18.25, 0.14); hall_send.add(b, 18.25, 0.25)
w = whoosh(0.3, 500, 6000, 0.85); sfx.add(w, 19.76, 0.2)

# --- S6 verbs: small whoosh between
for t0 in (20.92, 21.92, 22.92):
    sfx.add(whoosh(0.1, 1200, 6000, 0.7), t0, 0.1)
sfx.add(whoosh(0.3, 300, 5000, 0.9), 23.72, 0.2)

# --- S7: trillion counter, logo sting, mascot
SCALE = [74, 76, 78, 79, 81, 83, 85, 86, 88, 90, 91, 93, 98]
for i, (t0, m) in enumerate(zip(CUES["digits"], SCALE)):
    b = blip(m, 0.14, 0.9, 22); sfx.add(b, t0, 0.08 + 0.006 * i, pan=-0.5 + i / 12); hall_send.add(b, t0, 0.1)
sfx.add(whoosh(0.6, 300, 2500, 0.5), 25.9, 0.12)
for i, m in enumerate((62, 66, 69)):
    p_ = pluck(m + 12, 0.5, 10, 2, 0.06, 5); music.add(p_, 26.3 + i * 0.09, 0.1, pan=-0.3 + i * 0.3); hall_send.add(p_, 26.3 + i * 0.09, 0.1)
sh_n = int(0.62 * SR); t_w = tt(sh_n)
shim = sweep_bp(noise(sh_n), 1500, 9000, q=3) * np.sin(np.pi * t_w / 0.62)
sfx.add(fade(shim / (np.abs(shim).max() + 1e-9), 0.01, 0.05), 26.5, 0.06)
for i, m in enumerate((74, 78, 81, 88)):
    b = bell(m, 3.2, 1.0); music.add(b, 27.08 + i * 0.03, 0.2, pan=-0.3 + i * 0.2); hall_send.add(b, 27.08 + i * 0.03, 0.4)
lo_n = int(2.5 * SR); t_l = tt(lo_n)
sfx.add(fade(np.sin(2 * np.pi * 50 * t_l) * np.exp(-t_l * 1.6), 0.005, 0.2), 27.08, 0.35)
sfx.add(tick(2200, 0.02), 27.25, 0.14); sfx.add(blip(86, 0.1), 27.27, 0.06)
sfx.add(pop(), 27.5, 0.2, pan=0.55)
sfx.add(tick(6500, 0.02), 27.85, 0.06, pan=0.55)
for k in range(7):
    t0 = 28.15 + k * 0.1
    b = bell(96 + [0, 3, 7, 12, 7, 10, 15][k], 0.6, 0.5); sfx.add(b, t0, 0.05, pan=-0.6 + k * 0.2); hall_send.add(b, t0, 0.08)
sfx.add(pop(0.16), 28.56, 0.1, pan=0.55)
sfx.add(tick(6500, 0.02), 28.9, 0.05, pan=0.55)

# ------------------------------------------------------------------- mix
def sidechain(depth=0.55, tau=0.11):
    g = np.ones(N)
    t = tt(N)
    for tk in kick_times:
        i0 = int(tk * SR); i1 = min(N, i0 + int(0.45 * SR))
        if i0 >= N:
            continue
        s = t[i0:i1] - tk
        att = np.minimum(1, s / 0.004)
        g[i0:i1] = np.minimum(g[i0:i1], 1 - depth * att * np.exp(-s / tau))
    return g


def make_ir(rt60, length, seed, damp):
    r = np.random.default_rng(seed)
    n = int(length * SR); t = tt(n)
    ir = np.zeros((2, n))
    for ch in range(2):
        x = r.standard_normal(n) * np.exp(-6.9 * t / rt60)
        x = lp(x, damp) * 0.6 + lp(x, damp / 3) * 0.4
        x[: int(0.012 * SR)] *= np.linspace(0, 1, int(0.012 * SR))
        ir[ch] = x
    return ir / np.sqrt((ir ** 2).sum() / 2)


def convolve(x, ir):
    return np.stack([signal.fftconvolve(x[c], ir[c])[:N] for c in range(2)])


sc = sidechain()
music.x *= sc
bassb.x *= 1 - 0.45 * (1 - sc)
# arps get a ping-pong dotted-eighth delay
dl = int(0.375 * SR)
dly = np.zeros((2, N)); src = music.x * 0.22
for k in range(1, 5):
    seg = src * (0.42 ** (k - 1))
    ch = k % 2
    dly[ch, dl * k:] += seg[ch, : N - dl * k] + seg[1 - ch, : N - dl * k] * 0.3
hall = convolve(hall_send.x, make_ir(2.6, 3.2, 1, 7000))
room = convolve(room_send.x, make_ir(0.6, 0.9, 2, 9000))

if "--diag" in sys.argv:
    for b, x in (("drums", drums.x), ("bass", bassb.x), ("music", music.x), ("delay", dly * 0.5), ("sfx", sfx.x), ("hall", hall * 0.32), ("room", room * 0.25)):
        seg = lambda a, z: x[:, int(a * SR):int(z * SR)]
        rms = lambda a, z: 20 * np.log10(np.sqrt((seg(a, z) ** 2).mean()) + 1e-9)
        print(f"{b:6s} peak {20*np.log10(np.abs(x).max()+1e-9):6.1f}  rms intro {rms(0,4):6.1f}  main {rms(4.5,14):6.1f}  adctor {rms(14.6,17.8):6.1f}  verbs {rms(20,23.7):6.1f}  end {rms(24,29):6.1f}")
mix = (drums.x * 1.0 + bassb.x * 1.0 + music.x * 1.0 + dly * 0.9 + sfx.x * 0.9 + hall * 0.34 + room * 0.25) * 0.7
mix = np.stack([hp(mix[c], 30, 4) for c in range(2)])
mix = mix - 0.4 * np.stack([lp(mix[c], 75, 2) for c in range(2)])
# gentle tilt: tame harsh 3-6 kHz build-up a little, keep air
mix = mix - 0.12 * np.stack([bp(mix[c], 2800, 6000) for c in range(2)])
# bus glue
drive = 1.25
mix = np.tanh(mix * drive) / drive

# timing frame: broadcast-style silence in the last 0.5 s, tails fade from 29.0
t = tt(N)
mix *= np.clip((29.5 - t) / 0.5, 0, 1) ** 1.5
mix[:, : int(0.004 * SR)] *= np.linspace(0, 1, int(0.004 * SR))


def true_peak(x):
    return np.abs(signal.resample_poly(x, 4, 1, axis=1)).max()


def limiter(x, ceiling, look=0.003, rel=0.08):
    peak = np.abs(x).max(0)
    g = np.minimum(1.0, ceiling / np.maximum(peak, 1e-9))
    w = int(look * SR)
    from scipy.ndimage import minimum_filter1d
    g = minimum_filter1d(g, size=2 * w + 1)
    a = np.exp(-1 / (rel * SR))
    sm = np.empty_like(g); cur = 1.0
    for i in range(len(g)):  # release smoothing; attack is instant (lookahead window covers it)
        cur = g[i] if g[i] < cur else a * cur + (1 - a) * g[i]
        sm[i] = cur
    sm = np.convolve(sm, np.ones(w) / w, mode="same")
    return x * np.minimum(sm, g * 1.0 + 0 * sm)


meter = pyln.Meter(SR)
TARGET, CEIL = -14.0, 10 ** (-1.2 / 20)
for _ in range(3):
    lufs = meter.integrated_loudness(mix.T)
    mix *= 10 ** ((TARGET - lufs) / 20)
    mix = limiter(mix, CEIL * 0.97)
lufs = meter.integrated_loudness(mix.T)
tp = 20 * np.log10(true_peak(mix))
if tp > -1.0:
    mix *= 10 ** ((-1.0 - tp - 0.05) / 20)
lufs = meter.integrated_loudness(mix.T)
tp = 20 * np.log10(true_peak(mix))

import wave
pcm = np.clip(mix.T, -1, 1)
pcm24 = (pcm * (2 ** 23 - 1)).astype(np.int32)
raw = np.zeros((pcm24.shape[0], 2, 3), np.uint8)
for b in range(3):
    raw[..., b] = (pcm24 >> (8 * b)) & 0xFF
OUT.mkdir(exist_ok=True)
with wave.open(str(OUT / "score.wav"), "wb") as wf:
    wf.setnchannels(2); wf.setsampwidth(3); wf.setframerate(SR)
    wf.writeframes(raw.tobytes())
if "--diag" in sys.argv:
    mono = mix.mean(0)
    f, P_ = signal.welch(mono, SR, nperseg=8192)
    bands = [63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
    lv = [10 * np.log10(P_[(f >= b / 1.41) & (f < b * 1.41)].sum() + 1e-15) for b in bands]
    print("octave levels (dB, rel 1k):", " ".join(f"{b}:{l - lv[4]:+.1f}" for b, l in zip(bands, lv)))
    for a, z in ((0, 4), (4.5, 14), (14.6, 17.8), (20, 23.7), (24.2, 29)):
        print(f"short-term {a:5.1f}-{z:5.1f}s: {meter.integrated_loudness(mix[:, int(a*SR):int(z*SR)].T):6.1f} LUFS")
print(f"wrote out/score.wav  {DUR:.1f}s  integrated {lufs:.1f} LUFS  true peak {tp:.2f} dBTP")

if "--plot" in sys.argv:
    from PIL import Image
    mono = mix.mean(0)
    f, ts, S = signal.spectrogram(mono, SR, nperseg=2048, noverlap=1536)
    S = 10 * np.log10(S + 1e-12)
    keep = f < 12000
    S = S[keep][::-1]
    S = np.clip((S - (S.max() - 80)) / 80, 0, 1)
    img = (np.stack([S ** 0.7, S ** 1.2, S ** 0.4], -1) * 255).astype(np.uint8)
    im = Image.fromarray(img).resize((1800, 500))
    # waveform strip + second ticks
    wf_img = Image.new("RGB", (1800, 160), (12, 16, 24))
    from PIL import ImageDraw
    d = ImageDraw.Draw(wf_img)
    env = np.abs(mono).reshape(1800, -1).max(1)
    rms = np.sqrt((mono ** 2).reshape(1800, -1).mean(1))
    for x in range(1800):
        d.line([(x, 80 - env[x] * 78), (x, 80 + env[x] * 78)], fill=(70, 110, 200))
        d.line([(x, 80 - rms[x] * 78), (x, 80 + rms[x] * 78)], fill=(140, 220, 255))
    for s in range(31):
        x = int(s / 30 * 1799)
        d.line([(x, 0), (x, 12)], fill=(255, 80, 140)); d.text((x + 2, 12), str(s), fill=(255, 80, 140))
    out = Image.new("RGB", (1800, 660)); out.paste(im, (0, 0)); out.paste(wf_img, (0, 500))
    out.save(OUT / "score.png"); print("wrote out/score.png")
