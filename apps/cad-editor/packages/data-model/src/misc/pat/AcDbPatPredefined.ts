import type { AcDbPatDocument } from './AcDbPatDefinition'

/**
 * Predefined hatch patterns from the classic `acad.pat` library.
 */
export const AcDbPredefinedAcadPat: AcDbPatDocument = {
  patterns: [
    {
      name: 'SOLID',
      description: '',
      lines: []
    },
    {
      name: 'ANGLE',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 0.275,
          dashes: [0.2, -0.075],
          sourceLine: 23
        },
        {
          angle: 90,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 0.275,
          dashes: [0.2, -0.075],
          sourceLine: 24
        }
      ]
    },
    {
      name: 'ANSI31',
      description: '',
      lines: [
        {
          angle: 45,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 0.125,
          dashes: [],
          sourceLine: 26
        }
      ]
    },
    {
      name: 'ANSI32',
      description: '',
      lines: [
        {
          angle: 45,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 0.375,
          dashes: [],
          sourceLine: 28
        },
        {
          angle: 45,
          originX: 0.176776695,
          originY: 0,
          deltaX: 0,
          deltaY: 0.375,
          dashes: [],
          sourceLine: 29
        }
      ]
    },
    {
      name: 'ANSI33',
      description: '',
      lines: [
        {
          angle: 45,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 0.25,
          dashes: [],
          sourceLine: 31
        },
        {
          angle: 45,
          originX: 0.176776695,
          originY: 0,
          deltaX: 0,
          deltaY: 0.25,
          dashes: [0.125, -0.0625],
          sourceLine: 32
        }
      ]
    },
    {
      name: 'ANSI34',
      description: '',
      lines: [
        {
          angle: 45,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 0.75,
          dashes: [],
          sourceLine: 34
        },
        {
          angle: 45,
          originX: 0.176776695,
          originY: 0,
          deltaX: 0,
          deltaY: 0.75,
          dashes: [],
          sourceLine: 35
        },
        {
          angle: 45,
          originX: 0.353553391,
          originY: 0,
          deltaX: 0,
          deltaY: 0.75,
          dashes: [],
          sourceLine: 36
        },
        {
          angle: 45,
          originX: 0.530330086,
          originY: 0,
          deltaX: 0,
          deltaY: 0.75,
          dashes: [],
          sourceLine: 37
        }
      ]
    },
    {
      name: 'ANSI35',
      description: '',
      lines: [
        {
          angle: 45,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 0.25,
          dashes: [],
          sourceLine: 39
        },
        {
          angle: 45,
          originX: 0.176776695,
          originY: 0,
          deltaX: 0,
          deltaY: 0.25,
          dashes: [0.3125, -0.0625, 0, -0.0625],
          sourceLine: 40
        }
      ]
    },
    {
      name: 'ANSI36',
      description: '',
      lines: [
        {
          angle: 45,
          originX: 0,
          originY: 0,
          deltaX: 0.21875,
          deltaY: 0.125,
          dashes: [0.3125, -0.0625, 0, -0.0625],
          sourceLine: 42
        }
      ]
    },
    {
      name: 'ANSI37',
      description: '',
      lines: [
        {
          angle: 45,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 0.125,
          dashes: [],
          sourceLine: 44
        },
        {
          angle: 135,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 0.125,
          dashes: [],
          sourceLine: 45
        }
      ]
    },
    {
      name: 'ANSI38',
      description: '',
      lines: [
        {
          angle: 45,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 0.125,
          dashes: [],
          sourceLine: 47
        },
        {
          angle: 135,
          originX: 0,
          originY: 0,
          deltaX: 0.25,
          deltaY: 0.125,
          dashes: [0.3125, -0.1875],
          sourceLine: 48
        }
      ]
    },
    {
      name: 'AR-B816',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 8,
          dashes: [],
          sourceLine: 54
        },
        {
          angle: 90,
          originX: 0,
          originY: 0,
          deltaX: 8,
          deltaY: 8,
          dashes: [8, -8],
          sourceLine: 55
        }
      ]
    },
    {
      name: 'AR-B816C',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 8,
          deltaY: 8,
          dashes: [15.625, -0.375],
          sourceLine: 57
        },
        {
          angle: 0,
          originX: -8,
          originY: 0.375,
          deltaX: 8,
          deltaY: 8,
          dashes: [15.625, -0.375],
          sourceLine: 58
        },
        {
          angle: 90,
          originX: 0,
          originY: 0,
          deltaX: 8,
          deltaY: 8,
          dashes: [-8.375, 7.625],
          sourceLine: 59
        },
        {
          angle: 90,
          originX: -0.375,
          originY: 0,
          deltaX: 8,
          deltaY: 8,
          dashes: [-8.375, 7.625],
          sourceLine: 60
        }
      ]
    },
    {
      name: 'AR-B88',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 8,
          dashes: [],
          sourceLine: 62
        },
        {
          angle: 90,
          originX: 0,
          originY: 0,
          deltaX: 8,
          deltaY: 4,
          dashes: [8, -8],
          sourceLine: 63
        }
      ]
    },
    {
      name: 'AR-BRELM',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 5.334,
          dashes: [7.625, -0.375],
          sourceLine: 65
        },
        {
          angle: 0,
          originX: 0,
          originY: 2.25,
          deltaX: 0,
          deltaY: 5.334,
          dashes: [7.625, -0.375],
          sourceLine: 66
        },
        {
          angle: 0,
          originX: 2,
          originY: 2.667,
          deltaX: 0,
          deltaY: 5.334,
          dashes: [3.625, -0.375],
          sourceLine: 67
        },
        {
          angle: 0,
          originX: 2,
          originY: 4.917,
          deltaX: 0,
          deltaY: 5.334,
          dashes: [3.625, -0.375],
          sourceLine: 68
        },
        {
          angle: 90,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 8,
          dashes: [2.25, -3.084],
          sourceLine: 69
        },
        {
          angle: 90,
          originX: -0.375,
          originY: 0,
          deltaX: 0,
          deltaY: 8,
          dashes: [2.25, -3.084],
          sourceLine: 70
        },
        {
          angle: 90,
          originX: 2,
          originY: 2.667,
          deltaX: 0,
          deltaY: 4,
          dashes: [2.25, -3.084],
          sourceLine: 71
        },
        {
          angle: 90,
          originX: 1.625,
          originY: 2.667,
          deltaX: 0,
          deltaY: 4,
          dashes: [2.25, -3.084],
          sourceLine: 72
        }
      ]
    },
    {
      name: 'AR-BRSTD',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 2.667,
          dashes: [],
          sourceLine: 74
        },
        {
          angle: 90,
          originX: 0,
          originY: 0,
          deltaX: 2.667,
          deltaY: 4,
          dashes: [2.667, -2.667],
          sourceLine: 75
        }
      ]
    },
    {
      name: 'AR-CONC',
      description: '',
      lines: [
        {
          angle: 50,
          originX: 0,
          originY: 0,
          deltaX: 4.12975034,
          deltaY: -5.89789472,
          dashes: [0.75, -8.25],
          sourceLine: 77
        },
        {
          angle: 355,
          originX: 0,
          originY: 0,
          deltaX: -2.03781207,
          deltaY: 7.3723684,
          dashes: [0.6, -6.6],
          sourceLine: 78
        },
        {
          angle: 100.45144446,
          originX: 0.59771681,
          originY: -0.05229344,
          deltaX: 5.7305871,
          deltaY: -6.9397673,
          dashes: [0.63740192, -7.01142112],
          sourceLine: 79
        },
        {
          angle: 46.1842,
          originX: 0,
          originY: 2,
          deltaX: 6.19462554,
          deltaY: -8.84684596,
          dashes: [1.125, -12.375],
          sourceLine: 80
        },
        {
          angle: 96.63563549,
          originX: 0.88936745,
          originY: 1.86206693,
          deltaX: 8.59588239,
          deltaY: -10.40964966,
          dashes: [0.95610342, -10.5171376],
          sourceLine: 81
        },
        {
          angle: 351.18416399,
          originX: 0,
          originY: 2,
          deltaX: 7.74327494,
          deltaY: 11.05855746,
          dashes: [0.9, -9.90000001],
          sourceLine: 82
        },
        {
          angle: 21,
          originX: 1,
          originY: 1.5,
          deltaX: 4.12975034,
          deltaY: -5.89789472,
          dashes: [0.75, -8.25],
          sourceLine: 83
        },
        {
          angle: 326,
          originX: 1,
          originY: 1.5,
          deltaX: -2.03781207,
          deltaY: 7.3723684,
          dashes: [0.6, -6.6],
          sourceLine: 84
        },
        {
          angle: 71.45144474,
          originX: 1.49742254,
          originY: 1.16448426,
          deltaX: 5.7305871,
          deltaY: -6.9397673,
          dashes: [0.6374019, -7.01142112],
          sourceLine: 85
        },
        {
          angle: 37.5,
          originX: 0,
          originY: 0,
          deltaX: 2.123,
          deltaY: 2.567,
          dashes: [0, -6.52, 0, -6.7, 0, -6.625],
          sourceLine: 86
        },
        {
          angle: 7.5,
          originX: 0,
          originY: 0,
          deltaX: 3.123,
          deltaY: 3.567,
          dashes: [0, -3.82, 0, -6.37, 0, -2.525],
          sourceLine: 87
        },
        {
          angle: -32.5,
          originX: -2.23,
          originY: 0,
          deltaX: 4.6234,
          deltaY: 2.678,
          dashes: [0, -2.5, 0, -7.8, 0, -10.35],
          sourceLine: 88
        },
        {
          angle: -42.5,
          originX: -3.23,
          originY: 0,
          deltaX: 3.6234,
          deltaY: 4.678,
          dashes: [0, -3.25, 0, -5.18, 0, -7.35],
          sourceLine: 89
        }
      ]
    },
    {
      name: 'AR-HBONE',
      description: '',
      lines: [
        {
          angle: 45,
          originX: 0,
          originY: 0,
          deltaX: 4,
          deltaY: 4,
          dashes: [12, -4],
          sourceLine: 91
        },
        {
          angle: 135,
          originX: 2.828427125,
          originY: 2.828427125,
          deltaX: 4,
          deltaY: -4,
          dashes: [12, -4],
          sourceLine: 92
        }
      ]
    },
    {
      name: 'AR-PARQ1',
      description: '',
      lines: [
        {
          angle: 90,
          originX: 0,
          originY: 0,
          deltaX: 12,
          deltaY: 12,
          dashes: [12, -12],
          sourceLine: 94
        },
        {
          angle: 90,
          originX: 2,
          originY: 0,
          deltaX: 12,
          deltaY: 12,
          dashes: [12, -12],
          sourceLine: 95
        },
        {
          angle: 90,
          originX: 4,
          originY: 0,
          deltaX: 12,
          deltaY: 12,
          dashes: [12, -12],
          sourceLine: 96
        },
        {
          angle: 90,
          originX: 6,
          originY: 0,
          deltaX: 12,
          deltaY: 12,
          dashes: [12, -12],
          sourceLine: 97
        },
        {
          angle: 90,
          originX: 8,
          originY: 0,
          deltaX: 12,
          deltaY: 12,
          dashes: [12, -12],
          sourceLine: 98
        },
        {
          angle: 90,
          originX: 10,
          originY: 0,
          deltaX: 12,
          deltaY: 12,
          dashes: [12, -12],
          sourceLine: 99
        },
        {
          angle: 90,
          originX: 12,
          originY: 0,
          deltaX: 12,
          deltaY: 12,
          dashes: [12, -12],
          sourceLine: 100
        },
        {
          angle: 0,
          originX: 0,
          originY: 12,
          deltaX: 12,
          deltaY: -12,
          dashes: [12, -12],
          sourceLine: 101
        },
        {
          angle: 0,
          originX: 0,
          originY: 14,
          deltaX: 12,
          deltaY: -12,
          dashes: [12, -12],
          sourceLine: 102
        },
        {
          angle: 0,
          originX: 0,
          originY: 16,
          deltaX: 12,
          deltaY: -12,
          dashes: [12, -12],
          sourceLine: 103
        },
        {
          angle: 0,
          originX: 0,
          originY: 18,
          deltaX: 12,
          deltaY: -12,
          dashes: [12, -12],
          sourceLine: 104
        },
        {
          angle: 0,
          originX: 0,
          originY: 20,
          deltaX: 12,
          deltaY: -12,
          dashes: [12, -12],
          sourceLine: 105
        },
        {
          angle: 0,
          originX: 0,
          originY: 22,
          deltaX: 12,
          deltaY: -12,
          dashes: [12, -12],
          sourceLine: 106
        },
        {
          angle: 0,
          originX: 0,
          originY: 24,
          deltaX: 12,
          deltaY: -12,
          dashes: [12, -12],
          sourceLine: 107
        }
      ]
    },
    {
      name: 'AR-RROOF',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 2.2,
          deltaY: 1,
          dashes: [15, -2, 5, -1],
          sourceLine: 109
        },
        {
          angle: 0,
          originX: 1.33,
          originY: 0.5,
          deltaX: -1,
          deltaY: 1.33,
          dashes: [3, -0.33, 6, -0.75],
          sourceLine: 110
        },
        {
          angle: 0,
          originX: 0.5,
          originY: 0.85,
          deltaX: 5.2,
          deltaY: 0.67,
          dashes: [8, -1.4, 4, -1],
          sourceLine: 111
        }
      ]
    },
    {
      name: 'AR-RSHKE',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 25.5,
          deltaY: 12,
          dashes: [6, -5, 7, -3, 9, -4],
          sourceLine: 113
        },
        {
          angle: 0,
          originX: 6,
          originY: 0.5,
          deltaX: 25.5,
          deltaY: 12,
          dashes: [5, -19, 4, -6],
          sourceLine: 114
        },
        {
          angle: 0,
          originX: 18,
          originY: -0.75,
          deltaX: 25.5,
          deltaY: 12,
          dashes: [3, -31],
          sourceLine: 115
        },
        {
          angle: 90,
          originX: 0,
          originY: 0,
          deltaX: 12,
          deltaY: 8.5,
          dashes: [11.5, -36.5],
          sourceLine: 116
        },
        {
          angle: 90,
          originX: 6,
          originY: 0,
          deltaX: 12,
          deltaY: 8.5,
          dashes: [11.25, -36.75],
          sourceLine: 117
        },
        {
          angle: 90,
          originX: 11,
          originY: 0,
          deltaX: 12,
          deltaY: 8.5,
          dashes: [10.5, -37.5],
          sourceLine: 118
        },
        {
          angle: 90,
          originX: 18,
          originY: -0.75,
          deltaX: 12,
          deltaY: 8.5,
          dashes: [11.5, -36.5],
          sourceLine: 119
        },
        {
          angle: 90,
          originX: 21,
          originY: -0.75,
          deltaX: 12,
          deltaY: 8.5,
          dashes: [11.5, -36.5],
          sourceLine: 120
        },
        {
          angle: 90,
          originX: 30,
          originY: 0,
          deltaX: 12,
          deltaY: 8.5,
          dashes: [11, -37],
          sourceLine: 121
        }
      ]
    },
    {
      name: 'AR-SAND',
      description: '',
      lines: [
        {
          angle: 37.5,
          originX: 0,
          originY: 0,
          deltaX: 1.123,
          deltaY: 1.567,
          dashes: [0, -1.52, 0, -1.7, 0, -1.625],
          sourceLine: 123
        },
        {
          angle: 7.5,
          originX: 0,
          originY: 0,
          deltaX: 2.123,
          deltaY: 2.567,
          dashes: [0, -0.82, 0, -1.37, 0, -0.525],
          sourceLine: 124
        },
        {
          angle: -32.5,
          originX: -1.23,
          originY: 0,
          deltaX: 2.6234,
          deltaY: 1.678,
          dashes: [0, -0.5, 0, -1.8, 0, -2.35],
          sourceLine: 125
        },
        {
          angle: -42.5,
          originX: -1.23,
          originY: 0,
          deltaX: 1.6234,
          deltaY: 2.678,
          dashes: [0, -0.25, 0, -1.18, 0, -1.35],
          sourceLine: 126
        }
      ]
    },
    {
      name: 'BOX',
      description: '',
      lines: [
        {
          angle: 90,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 1,
          dashes: [],
          sourceLine: 128
        },
        {
          angle: 90,
          originX: 0.25,
          originY: 0,
          deltaX: 0,
          deltaY: 1,
          dashes: [],
          sourceLine: 129
        },
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 1,
          dashes: [-0.25, 0.25],
          sourceLine: 130
        },
        {
          angle: 0,
          originX: 0,
          originY: 0.25,
          deltaX: 0,
          deltaY: 1,
          dashes: [-0.25, 0.25],
          sourceLine: 131
        },
        {
          angle: 0,
          originX: 0,
          originY: 0.5,
          deltaX: 0,
          deltaY: 1,
          dashes: [0.25, -0.25],
          sourceLine: 132
        },
        {
          angle: 0,
          originX: 0,
          originY: 0.75,
          deltaX: 0,
          deltaY: 1,
          dashes: [0.25, -0.25],
          sourceLine: 133
        },
        {
          angle: 90,
          originX: 0.5,
          originY: 0,
          deltaX: 0,
          deltaY: 1,
          dashes: [0.25, -0.25],
          sourceLine: 134
        },
        {
          angle: 90,
          originX: 0.75,
          originY: 0,
          deltaX: 0,
          deltaY: 1,
          dashes: [0.25, -0.25],
          sourceLine: 135
        }
      ]
    },
    {
      name: 'BRASS',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 0.25,
          dashes: [],
          sourceLine: 137
        },
        {
          angle: 0,
          originX: 0,
          originY: 0.125,
          deltaX: 0,
          deltaY: 0.25,
          dashes: [0.125, -0.0625],
          sourceLine: 138
        }
      ]
    },
    {
      name: 'BRICK',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 0.25,
          dashes: [],
          sourceLine: 140
        },
        {
          angle: 90,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 0.5,
          dashes: [0.25, -0.25],
          sourceLine: 141
        },
        {
          angle: 90,
          originX: 0.25,
          originY: 0,
          deltaX: 0,
          deltaY: 0.5,
          dashes: [-0.25, 0.25],
          sourceLine: 142
        }
      ]
    },
    {
      name: 'BRSTONE',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 0.33,
          dashes: [],
          sourceLine: 144
        },
        {
          angle: 90,
          originX: 0.9,
          originY: 0,
          deltaX: 0.33,
          deltaY: 0.5,
          dashes: [0.33, -0.33],
          sourceLine: 145
        },
        {
          angle: 90,
          originX: 0.8,
          originY: 0,
          deltaX: 0.33,
          deltaY: 0.5,
          dashes: [0.33, -0.33],
          sourceLine: 146
        },
        {
          angle: 0,
          originX: 0.9,
          originY: 0.055,
          deltaX: 0.5,
          deltaY: 0.33,
          dashes: [-0.9, 0.1],
          sourceLine: 147
        },
        {
          angle: 0,
          originX: 0.9,
          originY: 0.11,
          deltaX: 0.5,
          deltaY: 0.33,
          dashes: [-0.9, 0.1],
          sourceLine: 148
        },
        {
          angle: 0,
          originX: 0.9,
          originY: 0.165,
          deltaX: 0.5,
          deltaY: 0.33,
          dashes: [-0.9, 0.1],
          sourceLine: 149
        },
        {
          angle: 0,
          originX: 0.9,
          originY: 0.22,
          deltaX: 0.5,
          deltaY: 0.33,
          dashes: [-0.9, 0.1],
          sourceLine: 150
        },
        {
          angle: 0,
          originX: 0.9,
          originY: 0.275,
          deltaX: 0.5,
          deltaY: 0.33,
          dashes: [-0.9, 0.1],
          sourceLine: 151
        }
      ]
    },
    {
      name: 'CLAY',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 0.1875,
          dashes: [],
          sourceLine: 153
        },
        {
          angle: 0,
          originX: 0,
          originY: 0.03125,
          deltaX: 0,
          deltaY: 0.1875,
          dashes: [],
          sourceLine: 154
        },
        {
          angle: 0,
          originX: 0,
          originY: 0.0625,
          deltaX: 0,
          deltaY: 0.1875,
          dashes: [],
          sourceLine: 155
        },
        {
          angle: 0,
          originX: 0,
          originY: 0.125,
          deltaX: 0,
          deltaY: 0.1875,
          dashes: [0.1875, -0.125],
          sourceLine: 156
        }
      ]
    },
    {
      name: 'CORK',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 0.125,
          dashes: [],
          sourceLine: 158
        },
        {
          angle: 135,
          originX: 0.0625,
          originY: -0.0625,
          deltaX: 0,
          deltaY: 0.35355339,
          dashes: [0.176776696, -0.176776696],
          sourceLine: 159
        },
        {
          angle: 135,
          originX: 0.09375,
          originY: -0.0625,
          deltaX: 0,
          deltaY: 0.35355339,
          dashes: [0.176776696, -0.176776696],
          sourceLine: 160
        },
        {
          angle: 135,
          originX: 0.125,
          originY: -0.0625,
          deltaX: 0,
          deltaY: 0.35355339,
          dashes: [0.176776696, -0.176776696],
          sourceLine: 161
        }
      ]
    },
    {
      name: 'CROSS',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0.25,
          deltaY: 0.25,
          dashes: [0.125, -0.375],
          sourceLine: 163
        },
        {
          angle: 90,
          originX: 0.0625,
          originY: -0.0625,
          deltaX: 0.25,
          deltaY: 0.25,
          dashes: [0.125, -0.375],
          sourceLine: 164
        }
      ]
    },
    {
      name: 'DASH',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0.125,
          deltaY: 0.125,
          dashes: [0.125, -0.125],
          sourceLine: 166
        }
      ]
    },
    {
      name: 'DOLMIT',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 0.25,
          dashes: [],
          sourceLine: 168
        },
        {
          angle: 45,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 0.70710678,
          dashes: [0.3535533905932738, -0.7071067811865476],
          sourceLine: 169
        }
      ]
    },
    {
      name: 'DOTS',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0.03125,
          deltaY: 0.0625,
          dashes: [0, -0.0625],
          sourceLine: 171
        }
      ]
    },
    {
      name: 'EARTH',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0.25,
          deltaY: 0.25,
          dashes: [0.25, -0.25],
          sourceLine: 173
        },
        {
          angle: 0,
          originX: 0,
          originY: 0.09375,
          deltaX: 0.25,
          deltaY: 0.25,
          dashes: [0.25, -0.25],
          sourceLine: 174
        },
        {
          angle: 0,
          originX: 0,
          originY: 0.1875,
          deltaX: 0.25,
          deltaY: 0.25,
          dashes: [0.25, -0.25],
          sourceLine: 175
        },
        {
          angle: 90,
          originX: 0.03125,
          originY: 0.21875,
          deltaX: 0.25,
          deltaY: 0.25,
          dashes: [0.25, -0.25],
          sourceLine: 176
        },
        {
          angle: 90,
          originX: 0.125,
          originY: 0.21875,
          deltaX: 0.25,
          deltaY: 0.25,
          dashes: [0.25, -0.25],
          sourceLine: 177
        },
        {
          angle: 90,
          originX: 0.21875,
          originY: 0.21875,
          deltaX: 0.25,
          deltaY: 0.25,
          dashes: [0.25, -0.25],
          sourceLine: 178
        }
      ]
    },
    {
      name: 'ESCHER',
      description: '',
      lines: [
        {
          angle: 60,
          originX: 0,
          originY: 0,
          deltaX: -0.6,
          deltaY: 1.039230484,
          dashes: [1.1, -0.1],
          sourceLine: 180
        },
        {
          angle: 180,
          originX: 0,
          originY: 0,
          deltaX: -0.6,
          deltaY: 1.039230484,
          dashes: [1.1, -0.1],
          sourceLine: 181
        },
        {
          angle: 300,
          originX: 0,
          originY: 0,
          deltaX: 0.6,
          deltaY: 1.039230484,
          dashes: [1.1, -0.1],
          sourceLine: 182
        },
        {
          angle: 60,
          originX: 0.1,
          originY: 0,
          deltaX: -0.6,
          deltaY: 1.039230484,
          dashes: [0.2, -1],
          sourceLine: 183
        },
        {
          angle: 300,
          originX: 0.1,
          originY: 0,
          deltaX: 0.6,
          deltaY: 1.039230484,
          dashes: [0.2, -1],
          sourceLine: 184
        },
        {
          angle: 60,
          originX: -0.05,
          originY: 0.08660254,
          deltaX: -0.6,
          deltaY: 1.039230484,
          dashes: [0.2, -1],
          sourceLine: 185
        },
        {
          angle: 180,
          originX: -0.05,
          originY: 0.08660254,
          deltaX: -0.6,
          deltaY: 1.039230484,
          dashes: [0.2, -1],
          sourceLine: 186
        },
        {
          angle: 300,
          originX: -0.05,
          originY: -0.08660254,
          deltaX: 0.6,
          deltaY: 1.039230484,
          dashes: [0.2, -1],
          sourceLine: 187
        },
        {
          angle: 180,
          originX: -0.05,
          originY: -0.08660254,
          deltaX: -0.6,
          deltaY: 1.039230484,
          dashes: [0.2, -1],
          sourceLine: 188
        },
        {
          angle: 60,
          originX: -0.4,
          originY: 0,
          deltaX: -0.6,
          deltaY: 1.039230484,
          dashes: [0.2, -1],
          sourceLine: 189
        },
        {
          angle: 300,
          originX: -0.4,
          originY: 0,
          deltaX: 0.6,
          deltaY: 1.039230484,
          dashes: [0.2, -1],
          sourceLine: 190
        },
        {
          angle: 60,
          originX: 0.2,
          originY: -0.346410161,
          deltaX: -0.6,
          deltaY: 1.039230484,
          dashes: [0.2, -1],
          sourceLine: 191
        },
        {
          angle: 180,
          originX: 0.2,
          originY: -0.346410161,
          deltaX: -0.6,
          deltaY: 1.039230484,
          dashes: [0.2, -1],
          sourceLine: 192
        },
        {
          angle: 300,
          originX: 0.2,
          originY: 0.346410161,
          deltaX: 0.6,
          deltaY: 1.039230484,
          dashes: [0.2, -1],
          sourceLine: 193
        },
        {
          angle: 180,
          originX: 0.2,
          originY: 0.346410161,
          deltaX: -0.6,
          deltaY: 1.039230484,
          dashes: [0.2, -1],
          sourceLine: 194
        },
        {
          angle: 0,
          originX: 0.2,
          originY: 0.173205081,
          deltaX: -0.6,
          deltaY: 1.039230484,
          dashes: [0.7, -0.5],
          sourceLine: 195
        },
        {
          angle: 0,
          originX: 0.2,
          originY: -0.173205081,
          deltaX: -0.6,
          deltaY: 1.039230484,
          dashes: [0.7, -0.5],
          sourceLine: 196
        },
        {
          angle: 120,
          originX: 0.05,
          originY: 0.259807621,
          deltaX: 0.6,
          deltaY: 1.039230484,
          dashes: [0.7, -0.5],
          sourceLine: 197
        },
        {
          angle: 120,
          originX: -0.25,
          originY: 0.08660254,
          deltaX: 0.6,
          deltaY: 1.039230484,
          dashes: [0.7, -0.5],
          sourceLine: 198
        },
        {
          angle: 240,
          originX: -0.25,
          originY: -0.08660254,
          deltaX: 0.6,
          deltaY: 1.039230484,
          dashes: [0.7, -0.5],
          sourceLine: 199
        },
        {
          angle: 240,
          originX: 0.05,
          originY: -0.259807621,
          deltaX: 0.6,
          deltaY: 1.039230484,
          dashes: [0.7, -0.5],
          sourceLine: 200
        }
      ]
    },
    {
      name: 'FLEX',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 0.25,
          dashes: [0.25, -0.25],
          sourceLine: 202
        },
        {
          angle: 45,
          originX: 0.25,
          originY: 0,
          deltaX: 0.176776695296,
          deltaY: 0.176776695296,
          dashes: [0.0625, -0.2285533906, 0.0625, -0.353553390593],
          sourceLine: 203
        }
      ]
    },
    {
      name: 'GOST_GLASS',
      description: '',
      lines: [
        {
          angle: 45,
          originX: 0,
          originY: 0,
          deltaX: 6,
          deltaY: -6,
          dashes: [5, -7],
          sourceLine: 205
        },
        {
          angle: 45,
          originX: 2.12132,
          originY: 0,
          deltaX: 6,
          deltaY: -6,
          dashes: [2, -10],
          sourceLine: 206
        },
        {
          angle: 45,
          originX: 0,
          originY: 2.12132,
          deltaX: 6,
          deltaY: -6,
          dashes: [2, -10],
          sourceLine: 207
        }
      ]
    },
    {
      name: 'GOST_WOOD',
      description: '',
      lines: [
        {
          angle: 90,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: -6,
          dashes: [10, -2],
          sourceLine: 209
        },
        {
          angle: 90,
          originX: 2,
          originY: -2,
          deltaX: 0,
          deltaY: -6,
          dashes: [6, -1.5, 3, -1.5],
          sourceLine: 210
        },
        {
          angle: 90,
          originX: 4,
          originY: -5,
          deltaX: 0,
          deltaY: -6,
          dashes: [10, -2],
          sourceLine: 211
        }
      ]
    },
    {
      name: 'GOST_GROUND',
      description: '',
      lines: [
        {
          angle: 45,
          originX: 0,
          originY: 0,
          deltaX: 10,
          deltaY: -10,
          dashes: [20],
          sourceLine: 213
        },
        {
          angle: 45,
          originX: 3,
          originY: 0,
          deltaX: 10,
          deltaY: -10,
          dashes: [20],
          sourceLine: 214
        },
        {
          angle: 45,
          originX: 6,
          originY: 0,
          deltaX: 10,
          deltaY: -10,
          dashes: [20],
          sourceLine: 215
        }
      ]
    },
    {
      name: 'GRASS',
      description: '',
      lines: [
        {
          angle: 90,
          originX: 0,
          originY: 0,
          deltaX: 0.707106781,
          deltaY: 0.707106781,
          dashes: [0.1875, -1.226713563],
          sourceLine: 217
        },
        {
          angle: 45,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 1,
          dashes: [0.1875, -0.8125],
          sourceLine: 218
        },
        {
          angle: 135,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 1,
          dashes: [0.1875, -0.8125],
          sourceLine: 219
        }
      ]
    },
    {
      name: 'GRATE',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 0.03125,
          dashes: [],
          sourceLine: 221
        },
        {
          angle: 90,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 0.125,
          dashes: [],
          sourceLine: 222
        }
      ]
    },
    {
      name: 'GRAVEL',
      description: '',
      lines: [
        {
          angle: 228.012787504,
          originX: 0.72,
          originY: 1,
          deltaX: 12.0413651692039,
          deltaY: 0.0743294146632,
          dashes: [0.134536, -13.3190880470737],
          sourceLine: 224
        },
        {
          angle: 184.969740728,
          originX: 0.63,
          originY: 0.9,
          deltaX: -12.0415166747131,
          deltaY: 0.0433148081592,
          dashes: [0.230868, -22.85592476123],
          sourceLine: 225
        },
        {
          angle: 132.510447078,
          originX: 0.4,
          originY: 0.88,
          deltaX: -14.8659418273816,
          deltaY: 0.061429511683,
          dashes: [0.162788, -16.1160325960997],
          sourceLine: 226
        },
        {
          angle: 267.273689006,
          originX: 0.01,
          originY: 0.63,
          deltaX: -20.0249279039043,
          deltaY: 0.0475651493827,
          dashes: [0.210238, -20.813558041629],
          sourceLine: 227
        },
        {
          angle: 292.833654178,
          originX: 0,
          originY: 0.42,
          deltaX: -12.9999095019474,
          deltaY: 0.048507125026,
          dashes: [0.206155, -20.4093731280883],
          sourceLine: 228
        },
        {
          angle: 357.273689006,
          originX: 0.08,
          originY: 0.23,
          deltaX: -20.0249279039043,
          deltaY: 0.0475651493827,
          dashes: [0.210238, -20.813558041629],
          sourceLine: 229
        },
        {
          angle: 37.6942404667,
          originX: 0.29,
          originY: 0.22,
          deltaX: -16.4011800288558,
          deltaY: 0.0359675000664,
          dashes: [0.278029, -27.524848548916],
          sourceLine: 230
        },
        {
          angle: 72.2553283749,
          originX: 0.51,
          originY: 0.39,
          deltaX: 23.0867613281116,
          deltaY: 0.0380969659053,
          dashes: [0.262488, -25.9863214968134],
          sourceLine: 231
        },
        {
          angle: 121.429565615,
          originX: 0.59,
          originY: 0.64,
          deltaX: 15.2642639131074,
          deltaY: 0.047404546271,
          dashes: [0.21095, -20.884073109729],
          sourceLine: 232
        },
        {
          angle: 175.236358309,
          originX: 0.48,
          originY: 0.82,
          deltaX: -11.0450488205478,
          deltaY: 0.083045479801,
          dashes: [0.240832, -11.8007625787923],
          sourceLine: 233
        },
        {
          angle: 222.397437798,
          originX: 0.24,
          originY: 0.84,
          deltaX: 16.2787889313724,
          deltaY: 0.0321080648114,
          dashes: [0.311448, -30.8333750047949],
          sourceLine: 234
        },
        {
          angle: 138.814074834,
          originX: 1,
          originY: 0.62,
          deltaX: 9.2190645101588,
          deltaY: 0.0940720868851,
          dashes: [0.106301, -10.5238448127347],
          sourceLine: 235
        },
        {
          angle: 171.46923439,
          originX: 0.92,
          originY: 0.69,
          deltaX: -13.1528534931484,
          deltaY: 0.0494468176315,
          dashes: [0.202237, -20.021511416157],
          sourceLine: 236
        },
        {
          angle: 225,
          originX: 0.72,
          originY: 0.72,
          deltaX: 0.7071067811865,
          deltaY: 0.7071067811865,
          dashes: [0.141421, -1.2727925623731],
          sourceLine: 237
        },
        {
          angle: 203.198590514,
          originX: 0.65,
          originY: 0.84,
          deltaX: -5.3835637472478,
          deltaY: 0.1313064328928,
          dashes: [0.076158, -7.5396151058639],
          sourceLine: 238
        },
        {
          angle: 291.801409486,
          originX: 0.58,
          originY: 0.81,
          deltaX: -3.156820749011,
          deltaY: 0.185695338158,
          dashes: [0.107703, -5.2774618071345],
          sourceLine: 239
        },
        {
          angle: 30.9637565321,
          originX: 0.62,
          originY: 0.71,
          deltaX: 3.6014702879928,
          deltaY: 0.1714985851408,
          dashes: [0.174929, -5.6560228948453],
          sourceLine: 240
        },
        {
          angle: 161.565051177,
          originX: 0.77,
          originY: 0.8,
          deltaX: -2.2135943621183,
          deltaY: 0.3162277660138,
          dashes: [0.126491, -3.0357866601684],
          sourceLine: 241
        },
        {
          angle: 16.389540334,
          originX: 0,
          originY: 0.81,
          deltaX: 10.4401539876873,
          deltaY: 0.0564332648047,
          dashes: [0.1772, -17.5428451466694],
          sourceLine: 242
        },
        {
          angle: 70.3461759419,
          originX: 0.17,
          originY: 0.86,
          deltaX: -11.7045066155395,
          deltaY: 0.0672672793901,
          dashes: [0.148661, -14.717407747319],
          sourceLine: 243
        },
        {
          angle: 293.198590514,
          originX: 0.77,
          originY: 1,
          deltaX: -5.3835637472478,
          deltaY: 0.1313064328928,
          dashes: [0.152315, -7.4634581058639],
          sourceLine: 244
        },
        {
          angle: 343.610459666,
          originX: 0.83,
          originY: 0.86,
          deltaX: -10.4401539876873,
          deltaY: 0.0564332648047,
          dashes: [0.1772, -17.542845146669],
          sourceLine: 245
        },
        {
          angle: 339.44395478,
          originX: 0,
          originY: 0.19,
          deltaX: -5.3838927710229,
          deltaY: 0.117041147157,
          dashes: [0.17088, -8.3731237453175],
          sourceLine: 246
        },
        {
          angle: 294.775140569,
          originX: 0.16,
          originY: 0.13,
          deltaX: -12.0828441168135,
          deltaY: 0.0698430296124,
          dashes: [0.143178, -14.174643063276],
          sourceLine: 247
        },
        {
          angle: 66.8014094864,
          originX: 0.78,
          originY: 0,
          deltaX: 5.3835637472487,
          deltaY: 0.1313064328552,
          dashes: [0.152315, -7.4634581058639],
          sourceLine: 248
        },
        {
          angle: 17.3540246363,
          originX: 0.84,
          originY: 0.14,
          deltaX: -13.6013396869991,
          deltaY: 0.0596549986364,
          dashes: [0.167631, -16.59542361424],
          sourceLine: 249
        },
        {
          angle: 69.4439547804,
          originX: 0.29,
          originY: 0,
          deltaX: -5.383892771022,
          deltaY: 0.1170411471946,
          dashes: [0.08544, -8.4585637453175],
          sourceLine: 250
        },
        {
          angle: 101.309932474,
          originX: 0.72,
          originY: 0,
          deltaX: 4.1184388379018,
          deltaY: 0.1961161351396,
          dashes: [0.05099, -5.0480295135928],
          sourceLine: 251
        },
        {
          angle: 165.963756532,
          originX: 0.71,
          originY: 0.05,
          deltaX: -3.1529631254726,
          deltaY: 0.2425356250323,
          dashes: [0.206155, -3.9169506256177],
          sourceLine: 252
        },
        {
          angle: 186.009005957,
          originX: 0.51,
          originY: 0.1,
          deltaX: -10.0497393137326,
          deltaY: 0.0523423921723,
          dashes: [0.19105, -18.9139231745428],
          sourceLine: 253
        },
        {
          angle: 303.690067526,
          originX: 0.62,
          originY: 0.62,
          deltaX: -2.2188007849008,
          deltaY: 0.2773500981134,
          dashes: [0.144222, -3.461329275464],
          sourceLine: 254
        },
        {
          angle: 353.157226587,
          originX: 0.7,
          originY: 0.5,
          deltaX: 17.1171966955143,
          deltaY: 0.0397150736497,
          dashes: [0.251794, -24.9275626240283],
          sourceLine: 255
        },
        {
          angle: 60.9453959009,
          originX: 0.95,
          originY: 0.47,
          deltaX: -8.0616726575653,
          deltaY: 0.0971285862325,
          dashes: [0.102956, -10.192674140987],
          sourceLine: 256
        },
        {
          angle: 90,
          originX: 1,
          originY: 0.56,
          deltaX: 1,
          deltaY: 1,
          dashes: [0.06, -0.94],
          sourceLine: 257
        },
        {
          angle: 120.256437164,
          originX: 0.49,
          originY: 0.13,
          deltaX: -8.0619364083848,
          deltaY: 0.0719815751411,
          dashes: [0.138924, -13.7535199894498],
          sourceLine: 258
        },
        {
          angle: 48.0127875042,
          originX: 0.42,
          originY: 0.25,
          deltaX: 12.0413651692041,
          deltaY: 0.0743294146212,
          dashes: [0.269072, -13.1845520470737],
          sourceLine: 259
        },
        {
          angle: 0,
          originX: 0.6,
          originY: 0.45,
          deltaX: 1,
          deltaY: 1,
          dashes: [0.26, -0.74],
          sourceLine: 260
        },
        {
          angle: 325.304846469,
          originX: 0.86,
          originY: 0.45,
          deltaX: 12.2063917682497,
          deltaY: -0.063245553253,
          dashes: [0.158114, -15.653274300842],
          sourceLine: 261
        },
        {
          angle: 254.054604099,
          originX: 0.99,
          originY: 0.36,
          deltaX: 4.1208169184605,
          deltaY: 0.1373605639542,
          dashes: [0.145602, -7.1345078892805],
          sourceLine: 262
        },
        {
          angle: 207.645975364,
          originX: 0.95,
          originY: 0.22,
          deltaX: 21.4708691170287,
          deltaY: 0.0421824539631,
          dashes: [0.237065, -23.4694741822594],
          sourceLine: 263
        },
        {
          angle: 175.42607874,
          originX: 0.74,
          originY: 0.11,
          deltaX: 13.0383438432524,
          deltaY: 0.039872611164,
          dashes: [0.250799, -24.8290734079689],
          sourceLine: 264
        }
      ]
    },
    {
      name: 'HEX',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 0.21650635094610965,
          dashes: [0.125, -0.25],
          sourceLine: 266
        },
        {
          angle: 120,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 0.21650635094610965,
          dashes: [0.125, -0.25],
          sourceLine: 267
        },
        {
          angle: 60,
          originX: 0.125,
          originY: 0,
          deltaX: 0,
          deltaY: 0.21650635094610965,
          dashes: [0.125, -0.25],
          sourceLine: 268
        }
      ]
    },
    {
      name: 'HONEY',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0.1875,
          deltaY: 0.10825317547305482,
          dashes: [0.125, -0.25],
          sourceLine: 270
        },
        {
          angle: 120,
          originX: 0,
          originY: 0,
          deltaX: 0.1875,
          deltaY: 0.10825317547305482,
          dashes: [0.125, -0.25],
          sourceLine: 271
        },
        {
          angle: 60,
          originX: 0,
          originY: 0,
          deltaX: 0.1875,
          deltaY: 0.10825317547305482,
          dashes: [-0.25, 0.125],
          sourceLine: 272
        }
      ]
    },
    {
      name: 'HOUND',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0.25,
          deltaY: 0.0625,
          dashes: [1, -0.5],
          sourceLine: 274
        },
        {
          angle: 90,
          originX: 0,
          originY: 0,
          deltaX: -0.25,
          deltaY: 0.0625,
          dashes: [1, -0.5],
          sourceLine: 275
        }
      ]
    },
    {
      name: 'INSUL',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 0.375,
          dashes: [],
          sourceLine: 277
        },
        {
          angle: 0,
          originX: 0,
          originY: 0.125,
          deltaX: 0,
          deltaY: 0.375,
          dashes: [0.125, -0.125],
          sourceLine: 278
        },
        {
          angle: 0,
          originX: 0,
          originY: 0.25,
          deltaX: 0,
          deltaY: 0.375,
          dashes: [0.125, -0.125],
          sourceLine: 279
        }
      ]
    },
    {
      name: 'ACAD_ISO02W100',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 5,
          dashes: [12, -3],
          sourceLine: 292
        }
      ]
    },
    {
      name: 'ACAD_ISO03W100',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 5,
          dashes: [12, -18],
          sourceLine: 294
        }
      ]
    },
    {
      name: 'ACAD_ISO04W100',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 5,
          dashes: [24, -3, 0.5, -3],
          sourceLine: 296
        }
      ]
    },
    {
      name: 'ACAD_ISO05W100',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 5,
          dashes: [24, -3, 0.5, -3, 0.5, -3],
          sourceLine: 298
        }
      ]
    },
    {
      name: 'ACAD_ISO06W100',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 5,
          dashes: [24, -3, 0.5, -3, 0.5, -6.5],
          sourceLine: 300
        },
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 5,
          dashes: [-34, 0.5, -3],
          sourceLine: 301
        }
      ]
    },
    {
      name: 'ACAD_ISO07W100',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 5,
          dashes: [0.5, -3],
          sourceLine: 303
        }
      ]
    },
    {
      name: 'ACAD_ISO08W100',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 5,
          dashes: [24, -3, 6, -3],
          sourceLine: 305
        }
      ]
    },
    {
      name: 'ACAD_ISO09W100',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 5,
          dashes: [24, -3, 6, -3, 6, -3],
          sourceLine: 307
        }
      ]
    },
    {
      name: 'ACAD_ISO10W100',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 5,
          dashes: [12, -3, 0.5, -3],
          sourceLine: 309
        }
      ]
    },
    {
      name: 'ACAD_ISO11W100',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 5,
          dashes: [12, -3, 12, -3, 0.5, -3],
          sourceLine: 311
        }
      ]
    },
    {
      name: 'ACAD_ISO12W100',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 5,
          dashes: [12, -3, 0.5, -3, 0.5, -3],
          sourceLine: 313
        }
      ]
    },
    {
      name: 'ACAD_ISO13W100',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 5,
          dashes: [12, -3, 12, -3, 0.5, -6.5],
          sourceLine: 315
        },
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 5,
          dashes: [-33.5, 0.5, -3],
          sourceLine: 316
        }
      ]
    },
    {
      name: 'ACAD_ISO14W100',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 5,
          dashes: [12, -3, 0.5, -3, 0.5, -6.5],
          sourceLine: 318
        },
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 5,
          dashes: [-22, 0.5, -3],
          sourceLine: 319
        }
      ]
    },
    {
      name: 'ACAD_ISO15W100',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 5,
          dashes: [12, -3, 12, -3, 0.5, -10],
          sourceLine: 321
        },
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 5,
          dashes: [-33.5, 0.5, -3, 0.5, -3],
          sourceLine: 322
        }
      ]
    },
    {
      name: 'LINE',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 0.125,
          dashes: [],
          sourceLine: 327
        }
      ]
    },
    {
      name: 'MUDST',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0.5,
          deltaY: 0.25,
          dashes: [0.25, -0.25, 0, -0.25, 0, -0.25],
          sourceLine: 329
        }
      ]
    },
    {
      name: 'NET',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 0.125,
          dashes: [],
          sourceLine: 331
        },
        {
          angle: 90,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 0.125,
          dashes: [],
          sourceLine: 332
        }
      ]
    },
    {
      name: 'NET3',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 0.125,
          dashes: [],
          sourceLine: 334
        },
        {
          angle: 60,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 0.125,
          dashes: [],
          sourceLine: 335
        },
        {
          angle: 120,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 0.125,
          dashes: [],
          sourceLine: 336
        }
      ]
    },
    {
      name: 'PLAST',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 0.25,
          dashes: [],
          sourceLine: 338
        },
        {
          angle: 0,
          originX: 0,
          originY: 0.03125,
          deltaX: 0,
          deltaY: 0.25,
          dashes: [],
          sourceLine: 339
        },
        {
          angle: 0,
          originX: 0,
          originY: 0.0625,
          deltaX: 0,
          deltaY: 0.25,
          dashes: [],
          sourceLine: 340
        }
      ]
    },
    {
      name: 'PLASTI',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 0.25,
          dashes: [],
          sourceLine: 342
        },
        {
          angle: 0,
          originX: 0,
          originY: 0.03125,
          deltaX: 0,
          deltaY: 0.25,
          dashes: [],
          sourceLine: 343
        },
        {
          angle: 0,
          originX: 0,
          originY: 0.0625,
          deltaX: 0,
          deltaY: 0.25,
          dashes: [],
          sourceLine: 344
        },
        {
          angle: 0,
          originX: 0,
          originY: 0.15625,
          deltaX: 0,
          deltaY: 0.25,
          dashes: [],
          sourceLine: 345
        }
      ]
    },
    {
      name: 'SACNCR',
      description: '',
      lines: [
        {
          angle: 45,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 0.09375,
          dashes: [],
          sourceLine: 347
        },
        {
          angle: 45,
          originX: 0.066291261,
          originY: 0,
          deltaX: 0,
          deltaY: 0.09375,
          dashes: [0, -0.09375],
          sourceLine: 348
        }
      ]
    },
    {
      name: 'SQUARE',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 0.125,
          dashes: [0.125, -0.125],
          sourceLine: 350
        },
        {
          angle: 90,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 0.125,
          dashes: [0.125, -0.125],
          sourceLine: 351
        }
      ]
    },
    {
      name: 'STARS',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 0.216506351,
          dashes: [0.125, -0.125],
          sourceLine: 353
        },
        {
          angle: 60,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 0.216506351,
          dashes: [0.125, -0.125],
          sourceLine: 354
        },
        {
          angle: 120,
          originX: 0.0625,
          originY: 0.108253176,
          deltaX: 0,
          deltaY: 0.216506351,
          dashes: [0.125, -0.125],
          sourceLine: 355
        }
      ]
    },
    {
      name: 'STEEL',
      description: '',
      lines: [
        {
          angle: 45,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 0.125,
          dashes: [],
          sourceLine: 357
        },
        {
          angle: 45,
          originX: 0,
          originY: 0.0625,
          deltaX: 0,
          deltaY: 0.125,
          dashes: [],
          sourceLine: 358
        }
      ]
    },
    {
      name: 'SWAMP',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0.5,
          deltaY: 0.866025403,
          dashes: [0.125, -0.875],
          sourceLine: 360
        },
        {
          angle: 90,
          originX: 0.0625,
          originY: 0,
          deltaX: 0.866025403,
          deltaY: 0.5,
          dashes: [0.0625, -1.669550806],
          sourceLine: 361
        },
        {
          angle: 90,
          originX: 0.078125,
          originY: 0,
          deltaX: 0.866025403,
          deltaY: 0.5,
          dashes: [0.05, -1.682050806],
          sourceLine: 362
        },
        {
          angle: 90,
          originX: 0.046875,
          originY: 0,
          deltaX: 0.866025403,
          deltaY: 0.5,
          dashes: [0.05, -1.682050806],
          sourceLine: 363
        },
        {
          angle: 60,
          originX: 0.09375,
          originY: 0,
          deltaX: 0.5,
          deltaY: 0.866025403,
          dashes: [0.04, -0.96],
          sourceLine: 364
        },
        {
          angle: 120,
          originX: 0.03125,
          originY: 0,
          deltaX: 0.5,
          deltaY: 0.866025403,
          dashes: [0.04, -0.96],
          sourceLine: 365
        }
      ]
    },
    {
      name: 'TRANS',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 0.25,
          dashes: [],
          sourceLine: 367
        },
        {
          angle: 0,
          originX: 0,
          originY: 0.125,
          deltaX: 0,
          deltaY: 0.25,
          dashes: [0.125, -0.125],
          sourceLine: 368
        }
      ]
    },
    {
      name: 'TRIANG',
      description: '',
      lines: [
        {
          angle: 60,
          originX: 0,
          originY: 0,
          deltaX: 0.1875,
          deltaY: 0.324759526,
          dashes: [0.1875, -0.1875],
          sourceLine: 370
        },
        {
          angle: 120,
          originX: 0,
          originY: 0,
          deltaX: 0.1875,
          deltaY: 0.324759526,
          dashes: [0.1875, -0.1875],
          sourceLine: 371
        },
        {
          angle: 0,
          originX: -0.09375,
          originY: 0.162379763,
          deltaX: 0.1875,
          deltaY: 0.324759526,
          dashes: [0.1875, -0.1875],
          sourceLine: 372
        }
      ]
    },
    {
      name: 'ZIGZAG',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0.125,
          deltaY: 0.125,
          dashes: [0.125, -0.125],
          sourceLine: 374
        },
        {
          angle: 90,
          originX: 0.125,
          originY: 0,
          deltaX: 0.125,
          deltaY: 0.125,
          dashes: [0.125, -0.125],
          sourceLine: 375
        }
      ]
    }
  ],
  issues: []
}

/**
 * Predefined hatch patterns from the ISO-oriented `acadiso.pat` library.
 */
export const AcDbPredefinedAcadIsoPat: AcDbPatDocument = {
  patterns: [
    {
      name: 'SOLID',
      description: '',
      lines: []
    },
    {
      name: 'ANGLE',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 6.985,
          dashes: [5.08, -1.905],
          sourceLine: 20
        },
        {
          angle: 90,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 6.985,
          dashes: [5.08, -1.905],
          sourceLine: 21
        }
      ]
    },
    {
      name: 'ANSI31',
      description: '',
      lines: [
        {
          angle: 45,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 3.175,
          dashes: [],
          sourceLine: 23
        }
      ]
    },
    {
      name: 'ANSI32',
      description: '',
      lines: [
        {
          angle: 45,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 9.525,
          dashes: [],
          sourceLine: 25
        },
        {
          angle: 45,
          originX: 4.49013,
          originY: 0,
          deltaX: 0,
          deltaY: 9.525,
          dashes: [],
          sourceLine: 26
        }
      ]
    },
    {
      name: 'ANSI33',
      description: '',
      lines: [
        {
          angle: 45,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 6.35,
          dashes: [],
          sourceLine: 28
        },
        {
          angle: 45,
          originX: 4.49013,
          originY: 0,
          deltaX: 0,
          deltaY: 6.35,
          dashes: [3.175, -1.5875],
          sourceLine: 29
        }
      ]
    },
    {
      name: 'ANSI34',
      description: '',
      lines: [
        {
          angle: 45,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 19.05,
          dashes: [],
          sourceLine: 31
        },
        {
          angle: 45,
          originX: 4.49013,
          originY: 0,
          deltaX: 0,
          deltaY: 19.05,
          dashes: [],
          sourceLine: 32
        },
        {
          angle: 45,
          originX: 8.98026,
          originY: 0,
          deltaX: 0,
          deltaY: 19.05,
          dashes: [],
          sourceLine: 33
        },
        {
          angle: 45,
          originX: 13.4704,
          originY: 0,
          deltaX: 0,
          deltaY: 19.05,
          dashes: [],
          sourceLine: 34
        }
      ]
    },
    {
      name: 'ANSI35',
      description: '',
      lines: [
        {
          angle: 45,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 6.35,
          dashes: [],
          sourceLine: 36
        },
        {
          angle: 45,
          originX: 4.49013,
          originY: 0,
          deltaX: 0,
          deltaY: 6.35,
          dashes: [7.9375, -1.5875, 0, -1.5875],
          sourceLine: 37
        }
      ]
    },
    {
      name: 'ANSI36',
      description: '',
      lines: [
        {
          angle: 45,
          originX: 0,
          originY: 0,
          deltaX: 5.55625,
          deltaY: 3.175,
          dashes: [7.9375, -1.5875, 0, -1.5875],
          sourceLine: 39
        }
      ]
    },
    {
      name: 'ANSI37',
      description: '',
      lines: [
        {
          angle: 45,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 3.175,
          dashes: [],
          sourceLine: 41
        },
        {
          angle: 135,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 3.175,
          dashes: [],
          sourceLine: 42
        }
      ]
    },
    {
      name: 'ANSI38',
      description: '',
      lines: [
        {
          angle: 45,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 3.175,
          dashes: [],
          sourceLine: 44
        },
        {
          angle: 135,
          originX: 0,
          originY: 0,
          deltaX: 6.35,
          deltaY: 3.175,
          dashes: [7.9375, -4.7625],
          sourceLine: 45
        }
      ]
    },
    {
      name: 'AR-B816',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 203.2,
          dashes: [],
          sourceLine: 47
        },
        {
          angle: 90,
          originX: 0,
          originY: 0,
          deltaX: 203.2,
          deltaY: 203.2,
          dashes: [203.2, -203.2],
          sourceLine: 48
        }
      ]
    },
    {
      name: 'AR-B816C',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 203.2,
          deltaY: 203.2,
          dashes: [396.875, -9.525],
          sourceLine: 50
        },
        {
          angle: 0,
          originX: -203.2,
          originY: 9.525,
          deltaX: 203.2,
          deltaY: 203.2,
          dashes: [396.875, -9.525],
          sourceLine: 51
        },
        {
          angle: 90,
          originX: 0,
          originY: 0,
          deltaX: 203.2,
          deltaY: 203.2,
          dashes: [-212.725, 193.675],
          sourceLine: 52
        },
        {
          angle: 90,
          originX: -9.525,
          originY: 0,
          deltaX: 203.2,
          deltaY: 203.2,
          dashes: [-212.725, 193.675],
          sourceLine: 53
        }
      ]
    },
    {
      name: 'AR-B88',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 203.2,
          dashes: [],
          sourceLine: 55
        },
        {
          angle: 90,
          originX: 0,
          originY: 0,
          deltaX: 203.2,
          deltaY: 101.6,
          dashes: [203.2, -203.2],
          sourceLine: 56
        }
      ]
    },
    {
      name: 'AR-BRELM',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 135.484,
          dashes: [193.675, -9.525],
          sourceLine: 58
        },
        {
          angle: 0,
          originX: 0,
          originY: 57.15,
          deltaX: 0,
          deltaY: 135.484,
          dashes: [193.675, -9.525],
          sourceLine: 59
        },
        {
          angle: 0,
          originX: 50.8,
          originY: 67.7418,
          deltaX: 0,
          deltaY: 135.484,
          dashes: [92.075, -9.525],
          sourceLine: 60
        },
        {
          angle: 0,
          originX: 50.8,
          originY: 124.892,
          deltaX: 0,
          deltaY: 135.484,
          dashes: [92.075, -9.525],
          sourceLine: 61
        },
        {
          angle: 90,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 203.2,
          dashes: [57.15, -78.334],
          sourceLine: 62
        },
        {
          angle: 90,
          originX: -9.525,
          originY: 0,
          deltaX: 0,
          deltaY: 203.2,
          dashes: [57.15, -78.334],
          sourceLine: 63
        },
        {
          angle: 90,
          originX: 50.8,
          originY: 67.7418,
          deltaX: 0,
          deltaY: 101.6,
          dashes: [57.15, -78.334],
          sourceLine: 64
        },
        {
          angle: 90,
          originX: 41.275,
          originY: 67.7418,
          deltaX: 0,
          deltaY: 101.6,
          dashes: [57.15, -78.334],
          sourceLine: 65
        }
      ]
    },
    {
      name: 'AR-BRSTD',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 67.7418,
          dashes: [],
          sourceLine: 67
        },
        {
          angle: 90,
          originX: 0,
          originY: 0,
          deltaX: 67.7418,
          deltaY: 101.6,
          dashes: [67.7418, -67.7418],
          sourceLine: 68
        }
      ]
    },
    {
      name: 'AR-CONC',
      description: '',
      lines: [
        {
          angle: 50,
          originX: 0,
          originY: 0,
          deltaX: 104.896,
          deltaY: -149.807,
          dashes: [19.05, -209.55],
          sourceLine: 70
        },
        {
          angle: 355,
          originX: 0,
          originY: 0,
          deltaX: -51.76101082,
          deltaY: 187.25814969,
          dashes: [15.24, -167.64058417],
          sourceLine: 71
        },
        {
          angle: 100.4514447,
          originX: 15.182007,
          originY: -1.3282535,
          deltaX: 145.5569059,
          deltaY: -176.270089,
          dashes: [16.1900088, -178.0902446],
          sourceLine: 72
        },
        {
          angle: 46.1842,
          originX: 0,
          originY: 50.8,
          deltaX: 157.343,
          deltaY: -224.71,
          dashes: [28.575, -314.325],
          sourceLine: 73
        },
        {
          angle: 96.63555761,
          originX: 22.5899,
          originY: 47.2965,
          deltaX: 218.33577212,
          deltaY: -264.40480444,
          dashes: [24.28502314, -267.13560816],
          sourceLine: 74
        },
        {
          angle: 351.18415117,
          originX: 0,
          originY: 50.8,
          deltaX: 196.67912063,
          deltaY: 280.88740361,
          dashes: [22.85996707, -251.45973192],
          sourceLine: 75
        },
        {
          angle: 21,
          originX: 25.4,
          originY: 38.1,
          deltaX: 104.89565868,
          deltaY: -149.80652586,
          dashes: [19.05, -209.55],
          sourceLine: 76
        },
        {
          angle: 326,
          originX: 25.4,
          originY: 38.1,
          deltaX: -51.7604,
          deltaY: 187.258,
          dashes: [15.24, -167.64],
          sourceLine: 77
        },
        {
          angle: 71.451445,
          originX: 38.0345326,
          originY: 29.5779001,
          deltaX: 145.5567546,
          deltaY: -176.2700748,
          dashes: [16.1900088, -178.0899376],
          sourceLine: 78
        },
        {
          angle: 37.5,
          originX: 0,
          originY: 0,
          deltaX: 53.9242,
          deltaY: 65.2018,
          dashes: [0, -165.608, 0, -170.18, 0, -168.275],
          sourceLine: 79
        },
        {
          angle: 7.5,
          originX: 0,
          originY: 0,
          deltaX: 79.3242,
          deltaY: 90.6018,
          dashes: [0, -97.028, 0, -161.798, 0, -64.135],
          sourceLine: 80
        },
        {
          angle: -32.5,
          originX: -56.642,
          originY: 0,
          deltaX: 117.434,
          deltaY: 68.0212,
          dashes: [0, -63.5, 0, -198.12, 0, -262.89],
          sourceLine: 81
        },
        {
          angle: -42.5,
          originX: -82.042,
          originY: 0,
          deltaX: 92.0344,
          deltaY: 118.821,
          dashes: [0, -82.55, 0, -131.572, 0, -186.69],
          sourceLine: 82
        }
      ]
    },
    {
      name: 'AR-HBONE',
      description: '',
      lines: [
        {
          angle: 45,
          originX: 0,
          originY: 0,
          deltaX: 101.6,
          deltaY: 101.6,
          dashes: [304.8, -101.6],
          sourceLine: 84
        },
        {
          angle: 135,
          originX: 71.842,
          originY: 71.842,
          deltaX: 101.6,
          deltaY: -101.6,
          dashes: [304.8, -101.6],
          sourceLine: 85
        }
      ]
    },
    {
      name: 'AR-PARQ1',
      description: '',
      lines: [
        {
          angle: 90,
          originX: 0,
          originY: 0,
          deltaX: 304.8,
          deltaY: 304.8,
          dashes: [304.8, -304.8],
          sourceLine: 87
        },
        {
          angle: 90,
          originX: 50.8,
          originY: 0,
          deltaX: 304.8,
          deltaY: 304.8,
          dashes: [304.8, -304.8],
          sourceLine: 88
        },
        {
          angle: 90,
          originX: 101.6,
          originY: 0,
          deltaX: 304.8,
          deltaY: 304.8,
          dashes: [304.8, -304.8],
          sourceLine: 89
        },
        {
          angle: 90,
          originX: 152.4,
          originY: 0,
          deltaX: 304.8,
          deltaY: 304.8,
          dashes: [304.8, -304.8],
          sourceLine: 90
        },
        {
          angle: 90,
          originX: 203.2,
          originY: 0,
          deltaX: 304.8,
          deltaY: 304.8,
          dashes: [304.8, -304.8],
          sourceLine: 91
        },
        {
          angle: 90,
          originX: 254,
          originY: 0,
          deltaX: 304.8,
          deltaY: 304.8,
          dashes: [304.8, -304.8],
          sourceLine: 92
        },
        {
          angle: 90,
          originX: 304.8,
          originY: 0,
          deltaX: 304.8,
          deltaY: 304.8,
          dashes: [304.8, -304.8],
          sourceLine: 93
        },
        {
          angle: 0,
          originX: 0,
          originY: 304.8,
          deltaX: 304.8,
          deltaY: -304.8,
          dashes: [304.8, -304.8],
          sourceLine: 94
        },
        {
          angle: 0,
          originX: 0,
          originY: 355.6,
          deltaX: 304.8,
          deltaY: -304.8,
          dashes: [304.8, -304.8],
          sourceLine: 95
        },
        {
          angle: 0,
          originX: 0,
          originY: 406.4,
          deltaX: 304.8,
          deltaY: -304.8,
          dashes: [304.8, -304.8],
          sourceLine: 96
        },
        {
          angle: 0,
          originX: 0,
          originY: 457.2,
          deltaX: 304.8,
          deltaY: -304.8,
          dashes: [304.8, -304.8],
          sourceLine: 97
        },
        {
          angle: 0,
          originX: 0,
          originY: 508,
          deltaX: 304.8,
          deltaY: -304.8,
          dashes: [304.8, -304.8],
          sourceLine: 98
        },
        {
          angle: 0,
          originX: 0,
          originY: 558.8,
          deltaX: 304.8,
          deltaY: -304.8,
          dashes: [304.8, -304.8],
          sourceLine: 99
        },
        {
          angle: 0,
          originX: 0,
          originY: 609.6,
          deltaX: 304.8,
          deltaY: -304.8,
          dashes: [304.8, -304.8],
          sourceLine: 100
        }
      ]
    },
    {
      name: 'AR-RROOF',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 55.88,
          deltaY: 25.4,
          dashes: [381, -50.8, 127, -25.4],
          sourceLine: 102
        },
        {
          angle: 0,
          originX: 33.782,
          originY: 12.7,
          deltaX: -25.4,
          deltaY: 33.782,
          dashes: [76.2, -8.382, 152.4, -19.05],
          sourceLine: 103
        },
        {
          angle: 0,
          originX: 12.7,
          originY: 21.59,
          deltaX: 132.08,
          deltaY: 17.018,
          dashes: [203.2, -35.56, 101.6, -25.4],
          sourceLine: 104
        }
      ]
    },
    {
      name: 'AR-RSHKE',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 647.7,
          deltaY: 304.8,
          dashes: [152.4, -127, 177.8, -76.2, 228.6, -101.6],
          sourceLine: 106
        },
        {
          angle: 0,
          originX: 152.4,
          originY: 12.7,
          deltaX: 647.7,
          deltaY: 304.8,
          dashes: [127, -482.6, 101.6, -152.4],
          sourceLine: 107
        },
        {
          angle: 0,
          originX: 457.2,
          originY: -19.05,
          deltaX: 647.7,
          deltaY: 304.8,
          dashes: [76.2, -787.4],
          sourceLine: 108
        },
        {
          angle: 90,
          originX: 0,
          originY: 0,
          deltaX: 304.8,
          deltaY: 215.9,
          dashes: [292.1, -927.1],
          sourceLine: 109
        },
        {
          angle: 90,
          originX: 152.4,
          originY: 0,
          deltaX: 304.8,
          deltaY: 215.9,
          dashes: [285.75, -933.45],
          sourceLine: 110
        },
        {
          angle: 90,
          originX: 279.4,
          originY: 0,
          deltaX: 304.8,
          deltaY: 215.9,
          dashes: [266.7, -952.5],
          sourceLine: 111
        },
        {
          angle: 90,
          originX: 457.2,
          originY: -19.05,
          deltaX: 304.8,
          deltaY: 215.9,
          dashes: [292.1, -927.1],
          sourceLine: 112
        },
        {
          angle: 90,
          originX: 533.4,
          originY: -19.05,
          deltaX: 304.8,
          deltaY: 215.9,
          dashes: [292.1, -927.1],
          sourceLine: 113
        },
        {
          angle: 90,
          originX: 762,
          originY: 0,
          deltaX: 304.8,
          deltaY: 215.9,
          dashes: [279.4, -939.8],
          sourceLine: 114
        }
      ]
    },
    {
      name: 'AR-SAND',
      description: '',
      lines: [
        {
          angle: 37.5,
          originX: 0,
          originY: 0,
          deltaX: 28.5242,
          deltaY: 39.8018,
          dashes: [0, -38.608, 0, -43.18, 0, -41.275],
          sourceLine: 116
        },
        {
          angle: 7.5,
          originX: 0,
          originY: 0,
          deltaX: 53.9242,
          deltaY: 65.2018,
          dashes: [0, -20.828, 0, -34.798, 0, -13.335],
          sourceLine: 117
        },
        {
          angle: -32.5,
          originX: -31.242,
          originY: 0,
          deltaX: 66.6344,
          deltaY: 42.6212,
          dashes: [0, -12.7, 0, -45.72, 0, -59.69],
          sourceLine: 118
        },
        {
          angle: -42.5,
          originX: -31.242,
          originY: 0,
          deltaX: 41.2344,
          deltaY: 68.0212,
          dashes: [0, -6.35, 0, -29.972, 0, -34.29],
          sourceLine: 119
        }
      ]
    },
    {
      name: 'BOX',
      description: '',
      lines: [
        {
          angle: 90,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 25.4,
          dashes: [],
          sourceLine: 121
        },
        {
          angle: 90,
          originX: 6.35,
          originY: 0,
          deltaX: 0,
          deltaY: 25.4,
          dashes: [],
          sourceLine: 122
        },
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 25.4,
          dashes: [-6.35, 6.35],
          sourceLine: 123
        },
        {
          angle: 0,
          originX: 0,
          originY: 6.35,
          deltaX: 0,
          deltaY: 25.4,
          dashes: [-6.35, 6.35],
          sourceLine: 124
        },
        {
          angle: 0,
          originX: 0,
          originY: 12.7,
          deltaX: 0,
          deltaY: 25.4,
          dashes: [6.35, -6.35],
          sourceLine: 125
        },
        {
          angle: 0,
          originX: 0,
          originY: 19.05,
          deltaX: 0,
          deltaY: 25.4,
          dashes: [6.35, -6.35],
          sourceLine: 126
        },
        {
          angle: 90,
          originX: 12.7,
          originY: 0,
          deltaX: 0,
          deltaY: 25.4,
          dashes: [6.35, -6.35],
          sourceLine: 127
        },
        {
          angle: 90,
          originX: 19.05,
          originY: 0,
          deltaX: 0,
          deltaY: 25.4,
          dashes: [6.35, -6.35],
          sourceLine: 128
        }
      ]
    },
    {
      name: 'BRASS',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 6.35,
          dashes: [],
          sourceLine: 130
        },
        {
          angle: 0,
          originX: 0,
          originY: 3.175,
          deltaX: 0,
          deltaY: 6.35,
          dashes: [3.175, -1.5875],
          sourceLine: 131
        }
      ]
    },
    {
      name: 'BRICK',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 6.35,
          dashes: [],
          sourceLine: 133
        },
        {
          angle: 90,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 12.7,
          dashes: [6.35, -6.35],
          sourceLine: 134
        },
        {
          angle: 90,
          originX: 6.35,
          originY: 0,
          deltaX: 0,
          deltaY: 12.7,
          dashes: [-6.35, 6.35],
          sourceLine: 135
        }
      ]
    },
    {
      name: 'BRSTONE',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 8.382,
          dashes: [],
          sourceLine: 137
        },
        {
          angle: 90,
          originX: 22.86,
          originY: 0,
          deltaX: 8.382,
          deltaY: 12.7,
          dashes: [8.382, -8.382],
          sourceLine: 138
        },
        {
          angle: 90,
          originX: 20.32,
          originY: 0,
          deltaX: 8.382,
          deltaY: 12.7,
          dashes: [8.382, -8.382],
          sourceLine: 139
        },
        {
          angle: 0,
          originX: 22.86,
          originY: 1.397,
          deltaX: 12.7,
          deltaY: 8.382,
          dashes: [-22.86, 2.54],
          sourceLine: 140
        },
        {
          angle: 0,
          originX: 22.86,
          originY: 2.794,
          deltaX: 12.7,
          deltaY: 8.382,
          dashes: [-22.86, 2.54],
          sourceLine: 141
        },
        {
          angle: 0,
          originX: 22.86,
          originY: 4.191,
          deltaX: 12.7,
          deltaY: 8.382,
          dashes: [-22.86, 2.54],
          sourceLine: 142
        },
        {
          angle: 0,
          originX: 22.86,
          originY: 5.588,
          deltaX: 12.7,
          deltaY: 8.382,
          dashes: [-22.86, 2.54],
          sourceLine: 143
        },
        {
          angle: 0,
          originX: 22.86,
          originY: 6.985,
          deltaX: 12.7,
          deltaY: 8.382,
          dashes: [-22.86, 2.54],
          sourceLine: 144
        }
      ]
    },
    {
      name: 'CLAY',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 4.7625,
          dashes: [],
          sourceLine: 146
        },
        {
          angle: 0,
          originX: 0,
          originY: 0.79375,
          deltaX: 0,
          deltaY: 4.7625,
          dashes: [],
          sourceLine: 147
        },
        {
          angle: 0,
          originX: 0,
          originY: 1.5875,
          deltaX: 0,
          deltaY: 4.7625,
          dashes: [],
          sourceLine: 148
        },
        {
          angle: 0,
          originX: 0,
          originY: 3.175,
          deltaX: 0,
          deltaY: 4.7625,
          dashes: [4.7625, -3.175],
          sourceLine: 149
        }
      ]
    },
    {
      name: 'CORK',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 3.175,
          dashes: [],
          sourceLine: 151
        },
        {
          angle: 135,
          originX: 1.5875,
          originY: -1.5875,
          deltaX: 0,
          deltaY: 8.98026,
          dashes: [4.49013, -4.49013],
          sourceLine: 152
        },
        {
          angle: 135,
          originX: 2.38125,
          originY: -1.5875,
          deltaX: 0,
          deltaY: 8.98026,
          dashes: [4.49013, -4.49013],
          sourceLine: 153
        },
        {
          angle: 135,
          originX: 3.175,
          originY: -1.5875,
          deltaX: 0,
          deltaY: 8.98026,
          dashes: [4.49013, -4.49013],
          sourceLine: 154
        }
      ]
    },
    {
      name: 'CROSS',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 6.35,
          deltaY: 6.35,
          dashes: [3.175, -9.525],
          sourceLine: 156
        },
        {
          angle: 90,
          originX: 1.5875,
          originY: -1.5875,
          deltaX: 6.35,
          deltaY: 6.35,
          dashes: [3.175, -9.525],
          sourceLine: 157
        }
      ]
    },
    {
      name: 'DASH',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 3.175,
          deltaY: 3.175,
          dashes: [3.175, -3.175],
          sourceLine: 159
        }
      ]
    },
    {
      name: 'DOLMIT',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 6.35,
          dashes: [],
          sourceLine: 161
        },
        {
          angle: 45,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 17.9605,
          dashes: [8.980256121069154, -17.960512242138307],
          sourceLine: 162
        }
      ]
    },
    {
      name: 'DOTS',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0.79375,
          deltaY: 1.5875,
          dashes: [0, -1.5875],
          sourceLine: 164
        }
      ]
    },
    {
      name: 'EARTH',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 6.35,
          deltaY: 6.35,
          dashes: [6.35, -6.35],
          sourceLine: 166
        },
        {
          angle: 0,
          originX: 0,
          originY: 2.38125,
          deltaX: 6.35,
          deltaY: 6.35,
          dashes: [6.35, -6.35],
          sourceLine: 167
        },
        {
          angle: 0,
          originX: 0,
          originY: 4.7625,
          deltaX: 6.35,
          deltaY: 6.35,
          dashes: [6.35, -6.35],
          sourceLine: 168
        },
        {
          angle: 90,
          originX: 0.79375,
          originY: 5.55625,
          deltaX: 6.35,
          deltaY: 6.35,
          dashes: [6.35, -6.35],
          sourceLine: 169
        },
        {
          angle: 90,
          originX: 3.175,
          originY: 5.55625,
          deltaX: 6.35,
          deltaY: 6.35,
          dashes: [6.35, -6.35],
          sourceLine: 170
        },
        {
          angle: 90,
          originX: 5.55625,
          originY: 5.55625,
          deltaX: 6.35,
          deltaY: 6.35,
          dashes: [6.35, -6.35],
          sourceLine: 171
        }
      ]
    },
    {
      name: 'ESCHER',
      description: '',
      lines: [
        {
          angle: 60,
          originX: 0,
          originY: 0,
          deltaX: -15.24,
          deltaY: 26.3964542936,
          dashes: [27.94, -2.54],
          sourceLine: 173
        },
        {
          angle: 180,
          originX: 0,
          originY: 0,
          deltaX: -15.24,
          deltaY: 26.3964542936,
          dashes: [27.94, -2.54],
          sourceLine: 174
        },
        {
          angle: 300,
          originX: 0,
          originY: 0,
          deltaX: 15.24,
          deltaY: 26.3964542936,
          dashes: [27.94, -2.54],
          sourceLine: 175
        },
        {
          angle: 60,
          originX: 2.54,
          originY: 0,
          deltaX: -15.24,
          deltaY: 26.3964542936,
          dashes: [5.08, -25.4],
          sourceLine: 176
        },
        {
          angle: 300,
          originX: 2.54,
          originY: 0,
          deltaX: 15.24,
          deltaY: 26.3964542936,
          dashes: [5.08, -25.4],
          sourceLine: 177
        },
        {
          angle: 60,
          originX: -1.27,
          originY: 2.199704516,
          deltaX: -15.24,
          deltaY: 26.3964542936,
          dashes: [5.08, -25.4],
          sourceLine: 178
        },
        {
          angle: 180,
          originX: -1.27,
          originY: 2.199704516,
          deltaX: -15.24,
          deltaY: 26.3964542936,
          dashes: [5.08, -25.4],
          sourceLine: 179
        },
        {
          angle: 300,
          originX: -1.27,
          originY: -2.199704516,
          deltaX: 15.24,
          deltaY: 26.3964542936,
          dashes: [5.08, -25.4],
          sourceLine: 180
        },
        {
          angle: 180,
          originX: -1.27,
          originY: -2.199704516,
          deltaX: -15.24,
          deltaY: 26.3964542936,
          dashes: [5.08, -25.4],
          sourceLine: 181
        },
        {
          angle: 60,
          originX: -10.16,
          originY: 0,
          deltaX: -15.24,
          deltaY: 26.3964542936,
          dashes: [5.08, -25.4],
          sourceLine: 182
        },
        {
          angle: 300,
          originX: -10.16,
          originY: 0,
          deltaX: 15.24,
          deltaY: 26.3964542936,
          dashes: [5.08, -25.4],
          sourceLine: 183
        },
        {
          angle: 60,
          originX: 5.08,
          originY: -8.7988180894,
          deltaX: -15.24,
          deltaY: 26.3964542936,
          dashes: [5.08, -25.4],
          sourceLine: 184
        },
        {
          angle: 180,
          originX: 5.08,
          originY: -8.7988180894,
          deltaX: -15.24,
          deltaY: 26.3964542936,
          dashes: [5.08, -25.4],
          sourceLine: 185
        },
        {
          angle: 300,
          originX: 5.08,
          originY: 8.7988180894,
          deltaX: 15.24,
          deltaY: 26.3964542936,
          dashes: [5.08, -25.4],
          sourceLine: 186
        },
        {
          angle: 180,
          originX: 5.08,
          originY: 8.7988180894,
          deltaX: -15.24,
          deltaY: 26.3964542936,
          dashes: [5.08, -25.4],
          sourceLine: 187
        },
        {
          angle: 0,
          originX: 5.08,
          originY: 4.3994090574,
          deltaX: -15.24,
          deltaY: 26.3964542936,
          dashes: [17.78, -12.7],
          sourceLine: 188
        },
        {
          angle: 0,
          originX: 5.08,
          originY: -4.3994090574,
          deltaX: -15.24,
          deltaY: 26.3964542936,
          dashes: [17.78, -12.7],
          sourceLine: 189
        },
        {
          angle: 120,
          originX: 1.27,
          originY: 6.5991135734,
          deltaX: 15.24,
          deltaY: 26.3964542936,
          dashes: [17.78, -12.7],
          sourceLine: 190
        },
        {
          angle: 120,
          originX: -6.35,
          originY: 2.199704516,
          deltaX: 15.24,
          deltaY: 26.3964542936,
          dashes: [17.78, -12.7],
          sourceLine: 191
        },
        {
          angle: 240,
          originX: -6.35,
          originY: -2.199704516,
          deltaX: 15.24,
          deltaY: 26.3964542936,
          dashes: [17.78, -12.7],
          sourceLine: 192
        },
        {
          angle: 240,
          originX: 1.27,
          originY: -6.5991135734,
          deltaX: 15.24,
          deltaY: 26.3964542936,
          dashes: [17.78, -12.7],
          sourceLine: 193
        }
      ]
    },
    {
      name: 'FLEX',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 6.35,
          dashes: [6.35, -6.35],
          sourceLine: 195
        },
        {
          angle: 45,
          originX: 6.35,
          originY: 0,
          deltaX: 4.490128053,
          deltaY: 4.490128053,
          dashes: [1.5875, -5.8052561314, 1.5875, -8.9802561314],
          sourceLine: 196
        }
      ]
    },
    {
      name: 'GOST_GLASS',
      description: '',
      lines: [
        {
          angle: 45,
          originX: 0,
          originY: 0,
          deltaX: 6,
          deltaY: -6,
          dashes: [5, -7],
          sourceLine: 198
        },
        {
          angle: 45,
          originX: 2.12132,
          originY: 0,
          deltaX: 6,
          deltaY: -6,
          dashes: [2, -10],
          sourceLine: 199
        },
        {
          angle: 45,
          originX: 0,
          originY: 2.12132,
          deltaX: 6,
          deltaY: -6,
          dashes: [2, -10],
          sourceLine: 200
        }
      ]
    },
    {
      name: 'GOST_WOOD',
      description: '',
      lines: [
        {
          angle: 90,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: -6,
          dashes: [10, -2],
          sourceLine: 202
        },
        {
          angle: 90,
          originX: 2,
          originY: -2,
          deltaX: 0,
          deltaY: -6,
          dashes: [6, -1.5, 3, -1.5],
          sourceLine: 203
        },
        {
          angle: 90,
          originX: 4,
          originY: -5,
          deltaX: 0,
          deltaY: -6,
          dashes: [10, -2],
          sourceLine: 204
        }
      ]
    },
    {
      name: 'GOST_GROUND',
      description: '',
      lines: [
        {
          angle: 45,
          originX: 0,
          originY: 0,
          deltaX: 10,
          deltaY: -10,
          dashes: [20],
          sourceLine: 206
        },
        {
          angle: 45,
          originX: 3,
          originY: 0,
          deltaX: 10,
          deltaY: -10,
          dashes: [20],
          sourceLine: 207
        },
        {
          angle: 45,
          originX: 6,
          originY: 0,
          deltaX: 10,
          deltaY: -10,
          dashes: [20],
          sourceLine: 208
        }
      ]
    },
    {
      name: 'GRASS',
      description: '',
      lines: [
        {
          angle: 90,
          originX: 0,
          originY: 0,
          deltaX: 17.96051224,
          deltaY: 17.96051224,
          dashes: [4.7625, -31.15852448],
          sourceLine: 210
        },
        {
          angle: 45,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 25.4,
          dashes: [4.7625, -20.6375],
          sourceLine: 211
        },
        {
          angle: 135,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 25.4,
          dashes: [4.7625, -20.6375],
          sourceLine: 212
        }
      ]
    },
    {
      name: 'GRATE',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 0.79375,
          dashes: [],
          sourceLine: 214
        },
        {
          angle: 90,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 3.175,
          dashes: [],
          sourceLine: 215
        }
      ]
    },
    {
      name: 'GRAVEL',
      description: '',
      lines: [
        {
          angle: 228.0127875,
          originX: 18.288,
          originY: 25.4,
          deltaX: 305.85067529778,
          deltaY: 1.88796713245,
          dashes: [3.4172144, -338.30483639565],
          sourceLine: 217
        },
        {
          angle: 184.969741,
          originX: 16.002,
          originY: 22.86,
          deltaX: -305.8545235377,
          deltaY: 1.10019612724,
          dashes: [5.8640472, -580.54048893524],
          sourceLine: 218
        },
        {
          angle: 132.5104471,
          originX: 10.16,
          originY: 22.352,
          deltaX: -377.59492241548,
          deltaY: 1.56030959675,
          dashes: [4.1348152, -409.347227941],
          sourceLine: 219
        },
        {
          angle: 267.273689,
          originX: 0.254,
          originY: 16.002,
          deltaX: -508.63316875916,
          deltaY: 1.20815479432,
          dashes: [5.3400452, -528.66437425738],
          sourceLine: 220
        },
        {
          angle: 292.83365418,
          originX: 0,
          originY: 10.668,
          deltaX: -330.19770134945,
          deltaY: 1.23208097566,
          dashes: [5.236337, -518.39807745344],
          sourceLine: 221
        },
        {
          angle: 357.273689,
          originX: 2.032,
          originY: 5.842,
          deltaX: -508.63316875916,
          deltaY: 1.20815479432,
          dashes: [5.3400452, -528.66437425738],
          sourceLine: 222
        },
        {
          angle: 37.69424047,
          originX: 7.366,
          originY: 5.588,
          deltaX: -416.58997273292,
          deltaY: 0.91357450169,
          dashes: [7.0619366, -699.13115314247],
          sourceLine: 223
        },
        {
          angle: 72.25532837,
          originX: 12.954,
          originY: 9.906,
          deltaX: 586.40373773403,
          deltaY: 0.96766293399,
          dashes: [6.6671952, -660.05256601905],
          sourceLine: 224
        },
        {
          angle: 121.42956562,
          originX: 14.986,
          originY: 16.256,
          deltaX: 387.71230339293,
          deltaY: 1.2040754753,
          dashes: [5.35813, -530.45545698712],
          sourceLine: 225
        },
        {
          angle: 175.2363583,
          originX: 12.192,
          originY: 20.828,
          deltaX: -280.5442400419,
          deltaY: 2.10935518695,
          dashes: [6.1171328, -299.7393695],
          sourceLine: 226
        },
        {
          angle: 222.3974378,
          originX: 6.096,
          originY: 21.336,
          deltaX: 413.48123885686,
          deltaY: 0.81554484621,
          dashes: [7.9107792, -783.16772512177],
          sourceLine: 227
        },
        {
          angle: 138.81407483,
          originX: 25.4,
          originY: 15.748,
          deltaX: 234.164238558,
          deltaY: 2.38943100688,
          dashes: [2.7000454, -267.30565824344],
          sourceLine: 228
        },
        {
          angle: 171.4692344,
          originX: 23.368,
          originY: 17.526,
          deltaX: -334.082478726,
          deltaY: 1.25594916784,
          dashes: [5.1368198, -508.5463899704],
          sourceLine: 229
        },
        {
          angle: 225,
          originX: 18.288,
          originY: 18.288,
          deltaX: 17.96051224214,
          deltaY: 17.96051224214,
          dashes: [3.5920934, -32.32893108428],
          sourceLine: 230
        },
        {
          angle: 203.19859051,
          originX: 16.51,
          originY: 21.336,
          deltaX: -136.74251918,
          deltaY: 3.33518339548,
          dashes: [1.9344132, -191.50622368894],
          sourceLine: 231
        },
        {
          angle: 291.80140949,
          originX: 14.732,
          originY: 20.574,
          deltaX: -80.18324702488,
          deltaY: 4.71666158921,
          dashes: [2.7356562, -134.0475299],
          sourceLine: 232
        },
        {
          angle: 30.96375653,
          originX: 15.748,
          originY: 18.034,
          deltaX: 91.47734531502,
          deltaY: 4.35606406258,
          dashes: [4.4431966, -143.6629815291],
          sourceLine: 233
        },
        {
          angle: 161.56505118,
          originX: 19.558,
          originY: 20.32,
          deltaX: -56.2252967978,
          deltaY: 8.03218525675,
          dashes: [3.2128714, -77.10898116828],
          sourceLine: 234
        },
        {
          angle: 16.389540334,
          originX: 0,
          originY: 20.574,
          deltaX: 265.17991128726,
          deltaY: 1.43340492604,
          dashes: [4.50088, -445.58826672539],
          sourceLine: 235
        },
        {
          angle: 70.34617594,
          originX: 4.318,
          originY: 21.844,
          deltaX: -297.29446803469,
          deltaY: 1.70858889651,
          dashes: [3.7759894, -373.822156782],
          sourceLine: 236
        },
        {
          angle: 293.19859051,
          originX: 19.558,
          originY: 25.4,
          deltaX: -136.7425191801,
          deltaY: 3.33518339548,
          dashes: [3.868801, -189.57183588894],
          sourceLine: 237
        },
        {
          angle: 343.61045967,
          originX: 21.082,
          originY: 21.844,
          deltaX: -265.17991128725,
          deltaY: 1.433404926,
          dashes: [4.50088, -445.5882667254],
          sourceLine: 238
        },
        {
          angle: 339.44395478,
          originX: 0,
          originY: 4.826,
          deltaX: -136.75087638398,
          deltaY: 2.97284513779,
          dashes: [4.340352, -212.67734313106],
          sourceLine: 239
        },
        {
          angle: 294.7751406,
          originX: 4.064,
          originY: 3.302,
          deltaX: -306.90424056705,
          deltaY: 1.77401295215,
          dashes: [3.6367212, -360.0359338072],
          sourceLine: 240
        },
        {
          angle: 66.80140949,
          originX: 19.812,
          originY: 0,
          deltaX: 136.74251918012,
          deltaY: 3.33518339452,
          dashes: [3.868801, -189.57183588894],
          sourceLine: 241
        },
        {
          angle: 17.35402464,
          originX: 21.336,
          originY: 3.556,
          deltaX: -345.47402804977,
          deltaY: 1.51523696536,
          dashes: [4.2578274, -421.523759802],
          sourceLine: 242
        },
        {
          angle: 69.44395478,
          originX: 7.366,
          originY: 0,
          deltaX: -136.75087638396,
          deltaY: 2.97284513874,
          dashes: [2.170176, -214.84751913106],
          sourceLine: 243
        },
        {
          angle: 101.309932474,
          originX: 18.288,
          originY: 0,
          deltaX: 104.60834648271,
          deltaY: 4.98134983255,
          dashes: [1.295146, -128.21994964526],
          sourceLine: 244
        },
        {
          angle: 165.963756532,
          originX: 18.034,
          originY: 1.27,
          deltaX: -80.085263387,
          deltaY: 6.16040487582,
          dashes: [5.236337, -99.49054589069],
          sourceLine: 245
        },
        {
          angle: 186.00900596,
          originX: 12.954,
          originY: 2.54,
          deltaX: -255.26337856879,
          deltaY: 1.32949676118,
          dashes: [4.85267, -480.41364863337],
          sourceLine: 246
        },
        {
          angle: 303.69006753,
          originX: 15.748,
          originY: 15.748,
          deltaX: -56.35753993648,
          deltaY: 7.0446924921,
          dashes: [3.6632388, -87.9177635968],
          sourceLine: 247
        },
        {
          angle: 353.15722659,
          originX: 17.78,
          originY: 12.7,
          deltaX: 434.77679606606,
          deltaY: 1.0087628707,
          dashes: [6.3955676, -633.16009065031],
          sourceLine: 248
        },
        {
          angle: 60.9453959,
          originX: 24.13,
          originY: 11.938,
          deltaX: -204.76648550216,
          deltaY: 2.46706609031,
          dashes: [2.6150824, -258.8939231811],
          sourceLine: 249
        },
        {
          angle: 90,
          originX: 25.4,
          originY: 14.224,
          deltaX: 25.4,
          deltaY: 25.4,
          dashes: [1.524, -23.876],
          sourceLine: 250
        },
        {
          angle: 120.25643716,
          originX: 12.446,
          originY: 3.302,
          deltaX: -204.77318477297,
          deltaY: 1.8283320086,
          dashes: [3.5286696, -349.339407732],
          sourceLine: 251
        },
        {
          angle: 48.0127875,
          originX: 10.668,
          originY: 6.35,
          deltaX: 305.85067529778,
          deltaY: 1.88796713138,
          dashes: [6.8344288, -334.88762199565],
          sourceLine: 252
        },
        {
          angle: 0,
          originX: 15.24,
          originY: 11.43,
          deltaX: 25.4,
          deltaY: 25.4,
          dashes: [6.604, -18.796],
          sourceLine: 253
        },
        {
          angle: 325.3048465,
          originX: 21.844,
          originY: 11.43,
          deltaX: 310.04235091354,
          deltaY: -1.6064370526,
          dashes: [4.0160956, -397.5931672414],
          sourceLine: 254
        },
        {
          angle: 254.0546041,
          originX: 25.146,
          originY: 9.144,
          deltaX: 104.6687497289,
          deltaY: 3.48895832444,
          dashes: [3.6982908, -181.21650038772],
          sourceLine: 255
        },
        {
          angle: 207.64597536,
          originX: 24.13,
          originY: 5.588,
          deltaX: 545.36007557253,
          deltaY: 1.07143433066,
          dashes: [6.021451, -596.12464422938],
          sourceLine: 256
        },
        {
          angle: 175.42607874,
          originX: 18.796,
          originY: 2.794,
          deltaX: 331.1739336186,
          deltaY: 1.01276432357,
          dashes: [6.3702946, -630.6584645624],
          sourceLine: 257
        }
      ]
    },
    {
      name: 'HEX',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 5.4992613154,
          dashes: [3.175, -6.35],
          sourceLine: 259
        },
        {
          angle: 120,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 5.4992613154,
          dashes: [3.175, -6.35],
          sourceLine: 260
        },
        {
          angle: 60,
          originX: 3.175,
          originY: 0,
          deltaX: 0,
          deltaY: 5.4992613154,
          dashes: [3.175, -6.35],
          sourceLine: 261
        }
      ]
    },
    {
      name: 'HONEY',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 4.7625,
          deltaY: 2.749630645,
          dashes: [3.175, -6.35],
          sourceLine: 263
        },
        {
          angle: 120,
          originX: 0,
          originY: 0,
          deltaX: 4.7625,
          deltaY: 2.749630645,
          dashes: [3.175, -6.35],
          sourceLine: 264
        },
        {
          angle: 60,
          originX: 0,
          originY: 0,
          deltaX: 4.7625,
          deltaY: 2.749630645,
          dashes: [-6.35, 3.175],
          sourceLine: 265
        }
      ]
    },
    {
      name: 'HOUND',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 6.35,
          deltaY: 1.5875,
          dashes: [25.4, -12.7],
          sourceLine: 267
        },
        {
          angle: 90,
          originX: 0,
          originY: 0,
          deltaX: -6.35,
          deltaY: 1.5875,
          dashes: [25.4, -12.7],
          sourceLine: 268
        }
      ]
    },
    {
      name: 'INSUL',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 9.525,
          dashes: [],
          sourceLine: 270
        },
        {
          angle: 0,
          originX: 0,
          originY: 3.175,
          deltaX: 0,
          deltaY: 9.525,
          dashes: [3.175, -3.175],
          sourceLine: 271
        },
        {
          angle: 0,
          originX: 0,
          originY: 6.35,
          deltaX: 0,
          deltaY: 9.525,
          dashes: [3.175, -3.175],
          sourceLine: 272
        }
      ]
    },
    {
      name: 'ACAD_ISO02W100',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 5,
          dashes: [12, -3],
          sourceLine: 285
        }
      ]
    },
    {
      name: 'ACAD_ISO03W100',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 5,
          dashes: [12, -18],
          sourceLine: 287
        }
      ]
    },
    {
      name: 'ACAD_ISO04W100',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 5,
          dashes: [24, -3, 0.5, -3],
          sourceLine: 289
        }
      ]
    },
    {
      name: 'ACAD_ISO05W100',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 5,
          dashes: [24, -3, 0.5, -3, 0.5, -3],
          sourceLine: 291
        }
      ]
    },
    {
      name: 'ACAD_ISO06W100',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 5,
          dashes: [24, -3, 0.5, -3, 0.5, -6.5],
          sourceLine: 293
        },
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 5,
          dashes: [-34, 0.5, -3],
          sourceLine: 294
        }
      ]
    },
    {
      name: 'ACAD_ISO07W100',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 5,
          dashes: [0.5, -3],
          sourceLine: 296
        }
      ]
    },
    {
      name: 'ACAD_ISO08W100',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 5,
          dashes: [24, -3, 6, -3],
          sourceLine: 298
        }
      ]
    },
    {
      name: 'ACAD_ISO09W100',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 5,
          dashes: [24, -3, 6, -3, 6, -3],
          sourceLine: 300
        }
      ]
    },
    {
      name: 'ACAD_ISO10W100',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 5,
          dashes: [12, -3, 0.5, -3],
          sourceLine: 302
        }
      ]
    },
    {
      name: 'ACAD_ISO11W100',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 5,
          dashes: [12, -3, 12, -3, 0.5, -3],
          sourceLine: 304
        }
      ]
    },
    {
      name: 'ACAD_ISO12W100',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 5,
          dashes: [12, -3, 0.5, -3, 0.5, -3],
          sourceLine: 306
        }
      ]
    },
    {
      name: 'ACAD_ISO13W100',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 5,
          dashes: [12, -3, 12, -3, 0.5, -6.5],
          sourceLine: 308
        },
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 5,
          dashes: [-33.5, 0.5, -3],
          sourceLine: 309
        }
      ]
    },
    {
      name: 'ACAD_ISO14W100',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 5,
          dashes: [12, -3, 0.5, -3, 0.5, -6.5],
          sourceLine: 311
        },
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 5,
          dashes: [-22, 0.5, -3],
          sourceLine: 312
        }
      ]
    },
    {
      name: 'ACAD_ISO15W100',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 5,
          dashes: [12, -3, 12, -3, 0.5, -10],
          sourceLine: 314
        },
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 5,
          dashes: [-33.5, 0.5, -3, 0.5, -3],
          sourceLine: 315
        }
      ]
    },
    {
      name: 'JIS_LC_20',
      description: '',
      lines: [
        {
          angle: 45,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 20,
          dashes: [],
          sourceLine: 322
        },
        {
          angle: 45,
          originX: 0.4,
          originY: 0,
          deltaX: 0,
          deltaY: 20,
          dashes: [],
          sourceLine: 323
        }
      ]
    },
    {
      name: 'JIS_LC_20A',
      description: '',
      lines: [
        {
          angle: 45,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 20,
          dashes: [],
          sourceLine: 325
        },
        {
          angle: 45,
          originX: 1,
          originY: 0,
          deltaX: 0,
          deltaY: 20,
          dashes: [],
          sourceLine: 326
        }
      ]
    },
    {
      name: 'JIS_LC_8',
      description: '',
      lines: [
        {
          angle: 45,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 7.8,
          dashes: [],
          sourceLine: 328
        },
        {
          angle: 45,
          originX: 0.4,
          originY: 0,
          deltaX: 0,
          deltaY: 7.8,
          dashes: [],
          sourceLine: 329
        }
      ]
    },
    {
      name: 'JIS_LC_8A',
      description: '',
      lines: [
        {
          angle: 45,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 7.8,
          dashes: [],
          sourceLine: 331
        },
        {
          angle: 45,
          originX: 1,
          originY: 0,
          deltaX: 0,
          deltaY: 7.8,
          dashes: [],
          sourceLine: 332
        }
      ]
    },
    {
      name: 'JIS_RC_10',
      description: '',
      lines: [
        {
          angle: 45,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 10,
          dashes: [],
          sourceLine: 334
        },
        {
          angle: 45,
          originX: 0.725,
          originY: 0,
          deltaX: 0,
          deltaY: 10,
          dashes: [],
          sourceLine: 335
        },
        {
          angle: 45,
          originX: 1.45,
          originY: 0,
          deltaX: 0,
          deltaY: 10,
          dashes: [],
          sourceLine: 336
        }
      ]
    },
    {
      name: 'JIS_RC_15',
      description: '',
      lines: [
        {
          angle: 45,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 15,
          dashes: [],
          sourceLine: 338
        },
        {
          angle: 45,
          originX: 0.725,
          originY: 0,
          deltaX: 0,
          deltaY: 15,
          dashes: [],
          sourceLine: 339
        },
        {
          angle: 45,
          originX: 1.45,
          originY: 0,
          deltaX: 0,
          deltaY: 15,
          dashes: [],
          sourceLine: 340
        }
      ]
    },
    {
      name: 'JIS_RC_18',
      description: '',
      lines: [
        {
          angle: 45,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 18,
          dashes: [],
          sourceLine: 342
        },
        {
          angle: 45,
          originX: 1,
          originY: 0,
          deltaX: 0,
          deltaY: 18,
          dashes: [],
          sourceLine: 343
        },
        {
          angle: 45,
          originX: 2,
          originY: 0,
          deltaX: 0,
          deltaY: 18,
          dashes: [],
          sourceLine: 344
        }
      ]
    },
    {
      name: 'JIS_RC_30',
      description: '',
      lines: [
        {
          angle: 45,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 30,
          dashes: [],
          sourceLine: 346
        },
        {
          angle: 45,
          originX: 1,
          originY: 0,
          deltaX: 0,
          deltaY: 30,
          dashes: [],
          sourceLine: 347
        },
        {
          angle: 45,
          originX: 2,
          originY: 0,
          deltaX: 0,
          deltaY: 30,
          dashes: [],
          sourceLine: 348
        }
      ]
    },
    {
      name: 'JIS_STN_1E',
      description: '',
      lines: [
        {
          angle: 45,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 1,
          dashes: [],
          sourceLine: 350
        },
        {
          angle: 45,
          originX: 0.705,
          originY: 0,
          deltaX: 0,
          deltaY: 1,
          dashes: [1, -0.5],
          sourceLine: 351
        }
      ]
    },
    {
      name: 'JIS_STN_2.5',
      description: '',
      lines: [
        {
          angle: 45,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 2.5,
          dashes: [],
          sourceLine: 353
        },
        {
          angle: 45,
          originX: 1.765,
          originY: 0,
          deltaX: 0,
          deltaY: 2.5,
          dashes: [1.2, -0.5],
          sourceLine: 354
        }
      ]
    },
    {
      name: 'JIS_WOOD',
      description: '',
      lines: [
        {
          angle: 45,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 0.70710678,
          dashes: [],
          sourceLine: 356
        }
      ]
    },
    {
      name: 'LINE',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 3.175,
          dashes: [],
          sourceLine: 359
        }
      ]
    },
    {
      name: 'MUDST',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 12.7,
          deltaY: 6.35,
          dashes: [6.35, -6.35, 0, -6.35, 0, -6.35],
          sourceLine: 361
        }
      ]
    },
    {
      name: 'NET',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 3.175,
          dashes: [],
          sourceLine: 363
        },
        {
          angle: 90,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 3.175,
          dashes: [],
          sourceLine: 364
        }
      ]
    },
    {
      name: 'NET3',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 3.175,
          dashes: [],
          sourceLine: 366
        },
        {
          angle: 60,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 3.175,
          dashes: [],
          sourceLine: 367
        },
        {
          angle: 120,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 3.175,
          dashes: [],
          sourceLine: 368
        }
      ]
    },
    {
      name: 'PLAST',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 6.35,
          dashes: [],
          sourceLine: 370
        },
        {
          angle: 0,
          originX: 0,
          originY: 0.79375,
          deltaX: 0,
          deltaY: 6.35,
          dashes: [],
          sourceLine: 371
        },
        {
          angle: 0,
          originX: 0,
          originY: 1.5875,
          deltaX: 0,
          deltaY: 6.35,
          dashes: [],
          sourceLine: 372
        }
      ]
    },
    {
      name: 'PLASTI',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 6.35,
          dashes: [],
          sourceLine: 374
        },
        {
          angle: 0,
          originX: 0,
          originY: 0.79375,
          deltaX: 0,
          deltaY: 6.35,
          dashes: [],
          sourceLine: 375
        },
        {
          angle: 0,
          originX: 0,
          originY: 1.5875,
          deltaX: 0,
          deltaY: 6.35,
          dashes: [],
          sourceLine: 376
        },
        {
          angle: 0,
          originX: 0,
          originY: 3.96875,
          deltaX: 0,
          deltaY: 6.35,
          dashes: [],
          sourceLine: 377
        }
      ]
    },
    {
      name: 'SACNCR',
      description: '',
      lines: [
        {
          angle: 45,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 2.38125,
          dashes: [],
          sourceLine: 379
        },
        {
          angle: 45,
          originX: 1.6838,
          originY: 0,
          deltaX: 0,
          deltaY: 2.38125,
          dashes: [0, -2.38125],
          sourceLine: 380
        }
      ]
    },
    {
      name: 'SQUARE',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 3.175,
          dashes: [3.175, -3.175],
          sourceLine: 382
        },
        {
          angle: 90,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 3.175,
          dashes: [3.175, -3.175],
          sourceLine: 383
        }
      ]
    },
    {
      name: 'STARS',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 5.4992613154,
          dashes: [3.175, -3.175],
          sourceLine: 385
        },
        {
          angle: 60,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 5.4992613154,
          dashes: [3.175, -3.175],
          sourceLine: 386
        },
        {
          angle: 120,
          originX: 1.5875,
          originY: 2.7496306704,
          deltaX: 0,
          deltaY: 5.4992613154,
          dashes: [3.175, -3.175],
          sourceLine: 387
        }
      ]
    },
    {
      name: 'STEEL',
      description: '',
      lines: [
        {
          angle: 45,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 3.175,
          dashes: [],
          sourceLine: 389
        },
        {
          angle: 45,
          originX: 0,
          originY: 1.5875,
          deltaX: 0,
          deltaY: 3.175,
          dashes: [],
          sourceLine: 390
        }
      ]
    },
    {
      name: 'SWAMP',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 12.7,
          deltaY: 21.9970452362,
          dashes: [3.175, -22.225],
          sourceLine: 392
        },
        {
          angle: 90,
          originX: 1.5875,
          originY: 0,
          deltaX: 21.9970452362,
          deltaY: 12.7,
          dashes: [1.5875, -42.4065904724],
          sourceLine: 393
        },
        {
          angle: 90,
          originX: 1.984375,
          originY: 0,
          deltaX: 21.9970452362,
          deltaY: 12.7,
          dashes: [1.27, -42.7240904724],
          sourceLine: 394
        },
        {
          angle: 90,
          originX: 1.190625,
          originY: 0,
          deltaX: 21.9970452362,
          deltaY: 12.7,
          dashes: [1.27, -42.7240904724],
          sourceLine: 395
        },
        {
          angle: 60,
          originX: 2.38125,
          originY: 0,
          deltaX: 12.7,
          deltaY: 21.9970452362,
          dashes: [1.016, -24.384],
          sourceLine: 396
        },
        {
          angle: 120,
          originX: 0.79375,
          originY: 0,
          deltaX: 12.7,
          deltaY: 21.9970452362,
          dashes: [1.016, -24.384],
          sourceLine: 397
        }
      ]
    },
    {
      name: 'TRANS',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 0,
          deltaY: 6.35,
          dashes: [],
          sourceLine: 399
        },
        {
          angle: 0,
          originX: 0,
          originY: 3.175,
          deltaX: 0,
          deltaY: 6.35,
          dashes: [3.175, -3.175],
          sourceLine: 400
        }
      ]
    },
    {
      name: 'TRIANG',
      description: '',
      lines: [
        {
          angle: 60,
          originX: 0,
          originY: 0,
          deltaX: 4.7625,
          deltaY: 8.2488919604,
          dashes: [4.7625, -4.7625],
          sourceLine: 402
        },
        {
          angle: 120,
          originX: 0,
          originY: 0,
          deltaX: 4.7625,
          deltaY: 8.2488919604,
          dashes: [4.7625, -4.7625],
          sourceLine: 403
        },
        {
          angle: 0,
          originX: -2.38125,
          originY: 4.1244459802,
          deltaX: 4.7625,
          deltaY: 8.2488919604,
          dashes: [4.7625, -4.7625],
          sourceLine: 404
        }
      ]
    },
    {
      name: 'ZIGZAG',
      description: '',
      lines: [
        {
          angle: 0,
          originX: 0,
          originY: 0,
          deltaX: 3.175,
          deltaY: 3.175,
          dashes: [3.175, -3.175],
          sourceLine: 406
        },
        {
          angle: 90,
          originX: 3.175,
          originY: 0,
          deltaX: 3.175,
          deltaY: 3.175,
          dashes: [3.175, -3.175],
          sourceLine: 407
        }
      ]
    }
  ],
  issues: []
}
