class NoiseProcessor extends AudioWorkletProcessor {
	process(_inputs, outputs) {
		const output = outputs[0];
		for (const channel of output) {
			for (let i = 0; i < channel.length; i++) {
				channel[i] = Math.random() * 2 - 1;
			}
		}
		return true;
	}
}

registerProcessor('noise-processor', NoiseProcessor);
