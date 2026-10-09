/**
 * Minimal RIFF/WAVE container for raw PCM.
 *
 * Fish returns `format: "pcm"` — bare 16-bit LE mono samples with no header —
 * because the live path feeds an AudioContext directly. Voice previews are
 * played as a `<audio>` blob instead, which needs a real container, hence this
 * 44-byte header (the canonical PCM WAVE header).
 */
export function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
	const header = Buffer.alloc(44);
	header.write("RIFF", 0, "ascii");
	header.writeUInt32LE(36 + pcm.length, 4);
	header.write("WAVE", 8, "ascii");
	header.write("fmt ", 12, "ascii");
	header.writeUInt32LE(16, 16); // fmt chunk size
	header.writeUInt16LE(1, 20); // format: PCM
	header.writeUInt16LE(1, 22); // channels: mono
	header.writeUInt32LE(sampleRate, 24);
	header.writeUInt32LE(sampleRate * 2, 28); // byte rate
	header.writeUInt16LE(2, 32); // block align
	header.writeUInt16LE(16, 34); // bits per sample
	header.write("data", 36, "ascii");
	header.writeUInt32LE(pcm.length, 40);
	return Buffer.concat([header, pcm]);
}
