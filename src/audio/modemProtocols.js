export const PROTOCOLS = {
  'BELL-103': {
    label: 'BELL-103',
    baud: 300,
    fMark: 1270,
    fSpace: 1070,
    modulation: 'fsk',
    lpfAlpha: 0.05,
    carrierThreshold: 0.0005,
    description: 'FSK 300 BPS / MARK 1270 Hz / SPACE 1070 Hz',
  },
  'V.21': {
    label: 'V.21',
    baud: 300,
    fMark: 1180,
    fSpace: 980,
    modulation: 'fsk',
    lpfAlpha: 0.05,
    carrierThreshold: 0.0005,
    description: 'FSK 300 BPS / MARK 1180 Hz / SPACE 980 Hz',
  },
  'BELL-202': {
    label: 'BELL-202',
    baud: 1200,
    fMark: 1200,
    fSpace: 2200,
    modulation: 'fsk',
    lpfAlpha: 0.15,
    carrierThreshold: 0.0003,
    description: 'FSK 1200 BPS / MARK 1200 Hz / SPACE 2200 Hz',
  },
  'V.22': {
    label: 'V.22',
    baud: 600,
    fCarrier: 1200,
    modulation: 'bpsk',
    lpfAlpha: 0.10,
    carrierThreshold: 0.0005,
    description: 'BPSK 1200 BPS / CARRIER 1200 Hz (SIMPLIFIED)',
  },
};

export const PROTOCOL_KEYS = ['BELL-103', 'V.21', 'BELL-202', 'V.22'];
export const COMM_MODES = ['LOOPBACK', 'ACOUSTIC'];
