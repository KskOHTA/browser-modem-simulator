import { buildWorkletCode } from './buildWorkletCode.js';

/**
 * Web Audio API のライフサイクルを管理するクラス。
 * AudioContext、AudioWorkletNode、マイクストリームの生成・破棄を担う。
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.workletNode = null;
    this.micStream = null;
    this.micSource = null;
    /** @type {(byte: number) => void} */
    this.onByte = null;
  }

  /** AudioContext を初期化する（冪等） */
  async init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
  }

  /** suspended 状態の AudioContext を再開する */
  async resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  /**
   * 指定プロトコルの AudioWorkletNode を再生成する。
   * 既存ノードは破棄され、新しいノードが接続される。
   *
   * @param {object} config - modemProtocols.js の PROTOCOLS エントリ
   */
  async loadProtocol(config) {
    // 旧ノードの切断と破棄
    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      this.workletNode.disconnect();
      this.workletNode = null;
    }

    // 新しい Worklet コードを生成（ユニークなプロセッサー名付き）
    const { code, processorName } = buildWorkletCode(config);

    // Blob URL 経由で AudioWorklet モジュールを登録
    const blob = new Blob([code], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    await this.ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);

    // 新しい AudioWorkletNode を生成・接続
    this.workletNode = new AudioWorkletNode(this.ctx, processorName);
    this.workletNode.port.onmessage = (e) => {
      if (e.data.type === 'byte' && this.onByte) {
        this.onByte(e.data.value);
      }
    };

    // パススルー出力をスピーカーへ接続
    this.workletNode.connect(this.ctx.destination);

    // 音響モード中のマイクを新ノードへ再接続
    if (this.micSource) {
      this.micSource.connect(this.workletNode);
    }
  }

  /**
   * ループバックモード: BufferSource → WorkletNode のみ（スピーカー出力なし）
   * @param {AudioBufferSourceNode} bufferSource
   */
  connectLoopback(bufferSource) {
    // WorkletNode のパススルー出力はループバック音を鳴らさないようミュート
    this.workletNode.port.postMessage({ type: 'setMuteOutput', value: true });
    bufferSource.connect(this.workletNode);
  }

  /**
   * 音響モード: BufferSource → スピーカー（送信音）、マイク → WorkletNode（受信）
   * getUserMedia でマイク権限を取得する。
   * @param {AudioBufferSourceNode} bufferSource
   */
  async connectAcoustic(bufferSource) {
    // マイクストリームがまだなければ取得
    if (!this.micStream) {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      this.micSource = this.ctx.createMediaStreamSource(this.micStream);
      this.micSource.connect(this.workletNode);
    }

    // WorkletNode のパススルー出力をミュート（マイク音のフィードバック防止）
    this.workletNode.port.postMessage({ type: 'setMuteOutput', value: true });

    // 送信音をスピーカーへ出力
    bufferSource.connect(this.ctx.destination);
  }

  /** マイクストリームを停止する */
  stopMic() {
    if (this.micSource) {
      this.micSource.disconnect();
      this.micSource = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach(t => t.stop());
      this.micStream = null;
    }
  }

  /** AudioContext を完全に破棄する（コンポーネントアンマウント時に呼ぶ） */
  teardown() {
    this.stopMic();
    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.ctx && this.ctx.state !== 'closed') {
      this.ctx.close();
      this.ctx = null;
    }
  }
}
