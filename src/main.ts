import * as utilities from "./utilities";
import { WindowFunction } from "./utilities";
import extractors from "./featureExtractors";
import { ComplexSpectrum, fft } from "fftjs";
import { MeydaAnalyzer } from "./meyda-wa";

export type MeydaFeature = keyof typeof extractors;
export type AmplitudeSpectrum = Float32Array;
export type BarkScale = Float32Array;
export type MelFilterBank = number[][];
export type ChromaFilterBank = number[][];
export type Signal = Float32Array;

type SignalPreparedWithSpectrum = {
  signal: Signal;
  windowedSignal: Signal;
  complexSpectrum: ReturnType<typeof fft>;
  ampSpectrum: Float32Array;
};

/**
 * Meyda Module
 * @module meyda
 */

/**
 * Options for constructing a MeydaAnalyzer
 * @typedef {Object} MeydaOptions
 * @property {AudioContext} audioContext - The Audio Context for the MeydaAnalyzer to operate in.
 * @property {AudioNode} source - The Audio Node for Meyda to listen to.
 * @property {number} [bufferSize] - The size of the buffer.
 * @property {number} [hopSize] - The hop size between buffers.
 * @property {number} [sampleRate] - The number of samples per second in the audio context.
 * @property {Function} [callback] - A function to receive the frames of audio features
 * @property {string} [windowingFunction] - The Windowing Function to apply to the signal before transformation to the frequency domain
 * @property {string|Array.<string>} [featureExtractors] - Specify the feature extractors you want to run on the audio.
 * @property {boolean} [startImmediately] - Pass `true` to start feature extraction immediately
 * @property {number} [numberOfMFCCCoefficients] - The number of MFCC co-efficients that the MFCC feature extractor should return
 */

export type MeydaOptions = {
  audioContext: AudioContext;
  source: AudioNode;
  bufferSize: number;
  hopSize: number;
  sampleRate: number;
  callback: (arg: any) => any;
  // This should be a union type
  windowingFunction: WindowFunction;
  // This should be a union type
  // featureExtractors: typeof Object.keys(extractors)[number]
  featureExtractors: MeydaFeature[];
  startImmediately: boolean;
  numberOfMFCCCoefficients: number;
  outputs: number;
  inputs: number;
  channel: number;
};

/**
 * @class Meyda
 * @hideconstructor
 * @classdesc
 * The schema for the default export of the Meyda library.
 * @example
 * var Meyda = require('meyda');
 */
var Meyda = {
  /**
   * Meyda stores a reference to the relevant audio context here for use inside
   * the Web Audio API.
   * @instance
   * @member {AudioContext}
   */
  audioContext: null as unknown as AudioContext,
  /**
   * Meyda keeps an internal ScriptProcessorNode in which it runs audio feature
   * extraction. The ScriptProcessorNode is stored in this member variable.
   * @instance
   * @member {ScriptProcessorNode}
   */
  spn: null as unknown as ScriptProcessorNode,
  /**
   * The length of each buffer that Meyda will extract audio on. When recieving
   * input via the Web Audio API, the Script Processor Node chunks incoming audio
   * into arrays of this length. Longer buffers allow for more precision in the
   * frequency domain, but increase the amount of time it takes for Meyda to
   * output a set of audio features for the buffer. You can calculate how many
   * sets of audio features Meyda will output per second by dividing the
   * buffer size by the sample rate. If you're using Meyda for visualisation,
   * make sure that you're collecting audio features at a rate that's faster
   * than or equal to the video frame rate you expect.
   * @instance
   * @member {number}
   */
  bufferSize: 512,
  hopSize: 0,
  /**
   * The number of samples per second of the incoming audio. This affects
   * feature extraction outside of the context of the Web Audio API, and must be
   * set accurately - otherwise calculations will be off.
   * @instance
   * @member {number}
   */
  sampleRate: 44100,
  /**
   * The number of Mel bands to use in the Mel Frequency Cepstral Co-efficients
   * feature extractor
   * @instance
   * @member {number}
   */
  melBands: 26,
  /**
   * The number of bands to divide the spectrum into for the Chroma feature
   * extractor. 12 is the standard number of semitones per octave in the western
   * music tradition, but Meyda can use an arbitrary number of bands, which
   * can be useful for microtonal music.
   * @instance
   * @member {number}
   */
  chromaBands: 12,
  /**
   * A function you can provide that will be called for each buffer that Meyda
   * receives from its source node
   * @instance
   * @member {Function}
   */
  callback: null as unknown as Function,
  /**
   * Specify the windowing function to apply to the buffer before the
   * transformation from the time domain to the frequency domain is performed
   *
   * The default windowing function is the hanning window.
   *
   * @instance
   * @member {string}
   */
  windowingFunction: "hanning" as WindowFunction,
  /**
   * @member {object}
   */
  featureExtractors: extractors,
  EXTRACTION_STARTED: false,
  /**
   * The number of MFCC co-efficients that the MFCC feature extractor should return
   * @instance
   * @member {number}
   */
  numberOfMFCCCoefficients: 13,
  // internals
  _featuresToExtract: [] as MeydaFeature[],
  windowing: utilities.applyWindow,
  _errors: {
    notPow2: new Error(
      "Meyda: Buffer size must be a power of 2, e.g. 64 or 512"
    ),
    featureUndef: new Error("Meyda: No features defined."),
    invalidFeatureFmt: new Error("Meyda: Invalid feature format"),
    invalidInput: new Error("Meyda: Invalid input."),
    noAC: new Error("Meyda: No AudioContext specified."),
    noSource: new Error("Meyda: No source node specified."),
  },
  barkScale: null as unknown as BarkScale,
  melFilterBank: [] as MelFilterBank,
  chromaFilterBank: [] as ChromaFilterBank,
  signal: null as unknown as Signal,
  complexSpectrum: null as unknown as ComplexSpectrum,
  ampSpectrum: null as unknown as AmplitudeSpectrum,
  previousSignal: null as unknown as Signal,
  previousComplexSpectrum: null as unknown as ComplexSpectrum,
  previousAmpSpectrum: null as unknown as AmplitudeSpectrum,
  inputs: 1,
  outputs: 1,
  channel: 0,

  /**
   * @summary
   * Create a MeydaAnalyzer
   *
   * A factory function for creating a MeydaAnalyzer, the interface for using
   * Meyda in the context of Web Audio.
   *
   * @method
   * @param {MeydaOptions} options Options - an object containing configuration
   * @returns {MeydaAnalyzer}
   * @example
   * const analyzer = Meyda.createMeydaAnalyzer({
   *   "audioContext": audioContext,
   *   "source": source,
   *   "bufferSize": 512,
   *   "featureExtractors": ["rms"],
   *   "inputs": 2,
   *   "callback": features => {
   *     levelRangeElement.value = features.rms;
   *   }
   * });
   */
  createMeydaAnalyzer: function (options: MeydaOptions) {
    return new MeydaAnalyzer(options, Object.assign({}, Meyda));
  },

  /**
   * List available audio feature extractors. Return format provides the key to
   * be used in selecting the extractor in the extract methods
   *
   * @returns {Array.<string>} featureExtractors - a list of the keys of
   * available audio feature extractors
   */

  listAvailableFeatureExtractors: function () {
    return Object.keys(this.featureExtractors);
  },

  /**
   * Extract an audio feature from a buffer
   *
   * Unless `meyda.windowingFunction` is set otherwise, `extract` will
   * internally apply a hanning window to the buffer prior to conversion into
   * the frequency domain.
   *
   * @function
   * @param {(string|Array.<string>)} feature - the feature you want to extract
   * @param {Array.<number>} signal
   * An array of numbers that represents the signal. It should be of length
   * `meyda.bufferSize`
   * @param {Array.<number>} [previousSignal] - the previous buffer
   * @returns {object} Features
   * @example
   * meyda.bufferSize = 2048;
   * const features = meyda.extract(['zcr', 'spectralCentroid'], signal);
   */
  extract: function (
    feature: MeydaFeature | MeydaFeature[],
    signal: number[] | Signal,
    previousSignal: number[] | Signal
  ): any {
    if (!signal) throw this._errors.invalidInput;
    else if (typeof signal != "object") throw this._errors.invalidInput;
    else if (!feature) throw this._errors.featureUndef;
    else if (!utilities.isPowerOfTwo(signal.length)) throw this._errors.notPow2;

    if (
      typeof this.barkScale == "undefined" ||
      this.barkScale.length != this.bufferSize
    ) {
      this.barkScale = utilities.createBarkScale(
        this.bufferSize,
        this.sampleRate,
        this.bufferSize
      );
    }

    // Recalculate mel bank if buffer length changed
    if (
      typeof this.melFilterBank == "undefined" ||
      this.barkScale.length != this.bufferSize ||
      this.melFilterBank.length != this.melBands
    ) {
      this.melFilterBank = utilities.createMelFilterBank(
        Math.max(this.melBands, this.numberOfMFCCCoefficients),
        this.sampleRate,
        this.bufferSize
      );
    }

    // Recalculate chroma bank if buffer length changed
    if (
      typeof this.chromaFilterBank == "undefined" ||
      this.chromaFilterBank.length != this.chromaBands
    ) {
      this.chromaFilterBank = utilities.createChromaFilterBank(
        this.chromaBands,
        this.sampleRate,
        this.bufferSize
      );
    }

    if (signal.constructor !== Float32Array) {
      // signal is a normal array, convert to F32A
      this.signal = utilities.arrayToTyped(signal);
    } else {
      this.signal = signal;
    }

    let preparedSignal = prepareSignalWithSpectrum(
      signal,
      this.windowingFunction,
      this.bufferSize
    );

    this.signal = preparedSignal.windowedSignal;
    this.complexSpectrum = preparedSignal.complexSpectrum;
    this.ampSpectrum = preparedSignal.ampSpectrum;

    if (previousSignal) {
      let preparedSignal = prepareSignalWithSpectrum(
        previousSignal,
        this.windowingFunction,
        this.bufferSize
      );

      this.previousSignal = preparedSignal.windowedSignal;
      this.previousComplexSpectrum = preparedSignal.complexSpectrum;
      this.previousAmpSpectrum = preparedSignal.ampSpectrum;
    }

    const extract = (feature: string) => {
      return this.featureExtractors[feature]({
        ampSpectrum: this.ampSpectrum,
        chromaFilterBank: this.chromaFilterBank,
        complexSpectrum: this.complexSpectrum,
        signal: this.signal,
        bufferSize: this.bufferSize,
        sampleRate: this.sampleRate,
        barkScale: this.barkScale,
        melFilterBank: this.melFilterBank,
        previousSignal: this.previousSignal,
        previousAmpSpectrum: this.previousAmpSpectrum,
        previousComplexSpectrum: this.previousComplexSpectrum,
        numberOfMFCCCoefficients: this.numberOfMFCCCoefficients,
      });
    };

    if (typeof feature === "object") {
      return feature.reduce(
        (acc, el) =>
          Object.assign({}, acc, {
            [el]: extract(el),
          }),
        {}
      );
    } else if (typeof feature === "string") {
      return extract(feature);
    } else {
      throw this._errors.invalidFeatureFmt;
    }
  },
};

var prepareSignalWithSpectrum = function (
  providedSignal: number[] | Signal,
  windowingFunction: WindowFunction,
  bufferSize: number
): SignalPreparedWithSpectrum {
  var signal: Signal =
    providedSignal.constructor !== Float32Array
      ? utilities.arrayToTyped(providedSignal)
      : providedSignal;
  const windowedSignal = utilities.applyWindow(signal, windowingFunction);

  const complexSpectrum = fft(windowedSignal);
  const ampSpectrum = new Float32Array(bufferSize / 2);

  for (var i = 0; i < bufferSize / 2; i++) {
    ampSpectrum[i] = Math.sqrt(
      Math.pow(complexSpectrum.real[i], 2) +
        Math.pow(complexSpectrum.imag[i], 2)
    );
  }

  const preparedSignal: SignalPreparedWithSpectrum = {
    signal,
    windowedSignal: utilities.applyWindow(signal, windowingFunction),
    complexSpectrum,
    ampSpectrum,
  };

  return preparedSignal;
};

/**
 * The Meyda class
 * @type {Meyda}
 */
export default Meyda;

// @ts-ignore
if (typeof window !== "undefined") window.Meyda = Meyda;
