var Vr = [
  { name: "AC1.2", value: 1 },
  { name: "AC1.40", value: 2 },
  { name: "AC1.50", value: 3 },
  { name: "AC2.20", value: 4 },
  { name: "AC2.10", value: 5 },
  { name: "AC2.21", value: 6 },
  { name: "AC2.22", value: 7 },
  { name: "AC1001", value: 8 },
  { name: "AC1002", value: 9 },
  { name: "AC1003", value: 10 },
  { name: "AC1004", value: 11 },
  { name: "AC1005", value: 12 },
  { name: "AC1006", value: 13 },
  { name: "AC1007", value: 14 },
  { name: "AC1008", value: 15 },
  { name: "AC1009", value: 16 },
  { name: "AC1010", value: 17 },
  { name: "AC1011", value: 18 },
  { name: "AC1012", value: 19 },
  { name: "AC1013", value: 20 },
  { name: "AC1014", value: 21 },
  { name: "AC1500", value: 22 },
  { name: "AC1015", value: 23 },
  { name: "AC1800a", value: 24 },
  { name: "AC1018", value: 25 },
  { name: "AC2100a", value: 26 },
  { name: "AC1021", value: 27 },
  { name: "AC2400a", value: 28 },
  { name: "AC1024", value: 29 },
  { name: "AC1027", value: 31 },
  { name: "AC3200a", value: 32 },
  { name: "AC1032", value: 33 }
], dn = /* @__PURE__ */ function() {
  function e(n) {
    if (typeof n == "string") {
      var a = Vr.find(function(t) {
        return t.name === n;
      });
      if (!a)
        throw new Error("Unknown DWG version name: ".concat(n));
      this.name = a.name, this.value = a.value;
      return;
    }
    if (typeof n == "number") {
      var a = Vr.find(function(s) {
        return s.value === n;
      });
      if (!a)
        throw new Error("Unknown DWG version value: ".concat(n));
      this.name = a.name, this.value = a.value;
      return;
    }
    throw new Error("Invalid constructor argument for AcDbDwgVersion");
  }
  return e;
}(), un = function(e, n, a, t) {
  function s(o) {
    return o instanceof a ? o : new a(function(c) {
      c(o);
    });
  }
  return new (a || (a = Promise))(function(o, c) {
    function f(m) {
      try {
        l(t.next(m));
      } catch (b) {
        c(b);
      }
    }
    function d(m) {
      try {
        l(t.throw(m));
      } catch (b) {
        c(b);
      }
    }
    function l(m) {
      m.done ? o(m.value) : s(m.value).then(f, d);
    }
    l((t = t.apply(e, n || [])).next());
  });
}, pn = function(e, n) {
  var a = { label: 0, sent: function() {
    if (o[0] & 1) throw o[1];
    return o[1];
  }, trys: [], ops: [] }, t, s, o, c = Object.create((typeof Iterator == "function" ? Iterator : Object).prototype);
  return c.next = f(0), c.throw = f(1), c.return = f(2), typeof Symbol == "function" && (c[Symbol.iterator] = function() {
    return this;
  }), c;
  function f(l) {
    return function(m) {
      return d([l, m]);
    };
  }
  function d(l) {
    if (t) throw new TypeError("Generator is already executing.");
    for (; c && (c = 0, l[0] && (a = 0)), a; ) try {
      if (t = 1, s && (o = l[0] & 2 ? s.return : l[0] ? s.throw || ((o = s.return) && o.call(s), 0) : s.next) && !(o = o.call(s, l[1])).done) return o;
      switch (s = 0, o && (l = [l[0] & 2, o.value]), l[0]) {
        case 0:
        case 1:
          o = l;
          break;
        case 4:
          return a.label++, { value: l[1], done: !1 };
        case 5:
          a.label++, s = l[1], l = [0];
          continue;
        case 7:
          l = a.ops.pop(), a.trys.pop();
          continue;
        default:
          if (o = a.trys, !(o = o.length > 0 && o[o.length - 1]) && (l[0] === 6 || l[0] === 2)) {
            a = 0;
            continue;
          }
          if (l[0] === 3 && (!o || l[1] > o[0] && l[1] < o[3])) {
            a.label = l[1];
            break;
          }
          if (l[0] === 6 && a.label < o[1]) {
            a.label = o[1], o = l;
            break;
          }
          if (o && a.label < o[2]) {
            a.label = o[2], a.ops.push(l);
            break;
          }
          o[2] && a.ops.pop(), a.trys.pop();
          continue;
      }
      l = n.call(e, a);
    } catch (m) {
      l = [6, m], s = 0;
    } finally {
      t = o = 0;
    }
    if (l[0] & 5) throw l[1];
    return { value: l[0] ? l[1] : void 0, done: !0 };
  }
}, mn = function() {
  function e() {
    this.setupMessageHandler();
  }
  return e.prototype.setupMessageHandler = function() {
    var n = this;
    self.onmessage = function(a) {
      return un(n, void 0, void 0, function() {
        var t, s, o, c, f;
        return pn(this, function(d) {
          switch (d.label) {
            case 0:
              t = a.data, s = t.id, o = t.input, d.label = 1;
            case 1:
              return d.trys.push([1, 3, , 4]), [4, this.executeTask(o)];
            case 2:
              return c = d.sent(), this.sendResponse(s, !0, c), [3, 4];
            case 3:
              return f = d.sent(), this.sendResponse(s, !1, void 0, f instanceof Error ? f.message : String(f)), [3, 4];
            case 4:
              return [2];
          }
        });
      });
    };
  }, e.prototype.sendResponse = function(n, a, t, s) {
    var o = {
      id: n,
      success: a,
      data: t,
      error: s
    };
    self.postMessage(o);
  }, e;
}(), Mr;
(function(e) {
  e[e.UTF8 = 0] = "UTF8", e[e.US_ASCII = 1] = "US_ASCII", e[e.ISO_8859_1 = 2] = "ISO_8859_1", e[e.ISO_8859_2 = 3] = "ISO_8859_2", e[e.ISO_8859_3 = 4] = "ISO_8859_3", e[e.ISO_8859_4 = 5] = "ISO_8859_4", e[e.ISO_8859_5 = 6] = "ISO_8859_5", e[e.ISO_8859_6 = 7] = "ISO_8859_6", e[e.ISO_8859_7 = 8] = "ISO_8859_7", e[e.ISO_8859_8 = 9] = "ISO_8859_8", e[e.ISO_8859_9 = 10] = "ISO_8859_9", e[e.CP437 = 11] = "CP437", e[e.CP850 = 12] = "CP850", e[e.CP852 = 13] = "CP852", e[e.CP855 = 14] = "CP855", e[e.CP857 = 15] = "CP857", e[e.CP860 = 16] = "CP860", e[e.CP861 = 17] = "CP861", e[e.CP863 = 18] = "CP863", e[e.CP864 = 19] = "CP864", e[e.CP865 = 20] = "CP865", e[e.CP869 = 21] = "CP869", e[e.CP932 = 22] = "CP932", e[e.MACINTOSH = 23] = "MACINTOSH", e[e.BIG5 = 24] = "BIG5", e[e.CP949 = 25] = "CP949", e[e.JOHAB = 26] = "JOHAB", e[e.CP866 = 27] = "CP866", e[e.ANSI_1250 = 28] = "ANSI_1250", e[e.ANSI_1251 = 29] = "ANSI_1251", e[e.ANSI_1252 = 30] = "ANSI_1252", e[e.GB2312 = 31] = "GB2312", e[e.ANSI_1253 = 32] = "ANSI_1253", e[e.ANSI_1254 = 33] = "ANSI_1254", e[e.ANSI_1255 = 34] = "ANSI_1255", e[e.ANSI_1256 = 35] = "ANSI_1256", e[e.ANSI_1257 = 36] = "ANSI_1257", e[e.ANSI_874 = 37] = "ANSI_874", e[e.ANSI_932 = 38] = "ANSI_932", e[e.ANSI_936 = 39] = "ANSI_936", e[e.ANSI_949 = 40] = "ANSI_949", e[e.ANSI_950 = 41] = "ANSI_950", e[e.ANSI_1361 = 42] = "ANSI_1361", e[e.UTF16 = 43] = "UTF16", e[e.ANSI_1258 = 44] = "ANSI_1258", e[e.UNDEFINED = 255] = "UNDEFINED";
})(Mr || (Mr = {}));
var fn = [
  "utf-8",
  "utf-8",
  "iso-8859-1",
  "iso-8859-2",
  "iso-8859-3",
  "iso-8859-4",
  "iso-8859-5",
  "iso-8859-6",
  "iso-8859-7",
  "iso-8859-8",
  "iso-8859-9",
  "utf-8",
  "utf-8",
  "utf-8",
  "utf-8",
  "utf-8",
  "utf-8",
  "utf-8",
  "utf-8",
  "utf-8",
  "utf-8",
  "utf-8",
  "shift-jis",
  "macintosh",
  "big5",
  "utf-8",
  "utf-8",
  "ibm866",
  "windows-1250",
  "windows-1251",
  "windows-1252",
  "gbk",
  "windows-1253",
  "windows-1254",
  "windows-1255",
  "windows-1256",
  "windows-1257",
  "windows-874",
  "shift-jis",
  "gbk",
  "euc-kr",
  "big5",
  "utf-8",
  "utf-16le",
  "windows-1258"
], bn = function(e) {
  return fn[e];
}, D, Be, O, N, Ve, K, Ee, q, R, Q, Z, ge, xe, ye, U, ee, Ue, He, ve, Se, Ge, We, je, H, re, T, Te, Ye, I, P, Xe, B, ze, ae, x, Ke, vr, Sr, Ze, ne, Oe, Tr, Or, $, $e, Ne, G, te, oe, se, Je, qe, ie, Ae, De, Nr, Qe, ke, ce, Le, k, le, W, Ar, L, Dr, de, j, Ce, er, Me, Y, ue, X, pe, kr, we, z;
(D = {})[D.None = 0] = "None", D[D.Anonymous = 1] = "Anonymous", D[D.NonConstant = 2] = "NonConstant", D[D.Xref = 4] = "Xref", D[D.XrefOverlay = 8] = "XrefOverlay", D[D.ExternallyDependent = 16] = "ExternallyDependent", D[D.ResolvedOrDependent = 32] = "ResolvedOrDependent", D[D.ReferencedXref = 64] = "ReferencedXref";
(Be = {})[Be.BYBLOCK = 0] = "BYBLOCK", Be[Be.BYLAYER = 256] = "BYLAYER";
(O = {})[O.Rotated = 0] = "Rotated", O[O.Aligned = 1] = "Aligned", O[O.Angular = 2] = "Angular", O[O.Diameter = 3] = "Diameter", O[O.Radius = 4] = "Radius", O[O.Angular3Point = 5] = "Angular3Point", O[O.Ordinate = 6] = "Ordinate", O[O.ReferenceIsExclusive = 32] = "ReferenceIsExclusive", O[O.IsOrdinateXTypeFlag = 64] = "IsOrdinateXTypeFlag", O[O.IsCustomTextPositionFlag = 128] = "IsCustomTextPositionFlag";
(N = {})[N.TopLeft = 1] = "TopLeft", N[N.TopCenter = 2] = "TopCenter", N[N.TopRight = 3] = "TopRight", N[N.MiddleLeft = 4] = "MiddleLeft", N[N.MiddleCenter = 5] = "MiddleCenter", N[N.MiddleRight = 6] = "MiddleRight", N[N.BottomLeft = 7] = "BottomLeft", N[N.BottomCenter = 8] = "BottomCenter", N[N.BottomRight = 9] = "BottomRight";
(Ve = {})[Ve.AtLeast = 1] = "AtLeast", Ve[Ve.Exact = 2] = "Exact";
var Ur = ((K = {})[K.Center = 0] = "Center", K[K.Above = 1] = "Above", K[K.Outside = 2] = "Outside", K[K.JIS = 3] = "JIS", K[K.Below = 4] = "Below", K);
(Ee = {})[Ee.WithDimension = 0] = "WithDimension", Ee[Ee.AddLeader = 1] = "AddLeader", Ee[Ee.Independent = 2] = "Independent";
(q = {})[q.BothOutside = 0] = "BothOutside", q[q.ArrowFirst = 1] = "ArrowFirst", q[q.TextFirst = 2] = "TextFirst", q[q.Auto = 3] = "Auto";
var Fe = ((R = {})[R.Feet = 0] = "Feet", R[R.None = 1] = "None", R[R.Inch = 2] = "Inch", R[R.FeetAndInch = 3] = "FeetAndInch", R[R.Leading = 4] = "Leading", R[R.Trailing = 8] = "Trailing", R[R.LeadingAndTrailing = 12] = "LeadingAndTrailing", R), In = ((Q = {})[Q.None = 0] = "None", Q[Q.Leading = 1] = "Leading", Q[Q.Trailing = 2] = "Trailing", Q[Q.LeadingAndTrailing = 3] = "LeadingAndTrailing", Q), hn = ((Z = {})[Z.Center = 0] = "Center", Z[Z.First = 1] = "First", Z[Z.Second = 2] = "Second", Z[Z.OverFirst = 3] = "OverFirst", Z[Z.OverSecond = 4] = "OverSecond", Z), En = ((ge = {})[ge.Bottom = 0] = "Bottom", ge[ge.Center = 1] = "Center", ge[ge.Top = 2] = "Top", ge);
(xe = {})[xe.None = 0] = "None", xe[xe.UseDrawingBackground = 1] = "UseDrawingBackground", xe[xe.Custom = 2] = "Custom";
(ye = {})[ye.Horizontal = 0] = "Horizontal", ye[ye.Diagonal = 1] = "Diagonal", ye[ye.NotStacked = 2] = "NotStacked";
(U = {})[U.Scientific = 1] = "Scientific", U[U.Decimal = 2] = "Decimal", U[U.Engineering = 3] = "Engineering", U[U.Architectural = 4] = "Architectural", U[U.Fractional = 5] = "Fractional", U[U.WindowDesktop = 6] = "WindowDesktop";
(ee = {})[ee.Decimal = 0] = "Decimal", ee[ee.DegreesMinutesSecond = 1] = "DegreesMinutesSecond", ee[ee.Gradian = 2] = "Gradian", ee[ee.Radian = 3] = "Radian";
(Ue = {})[Ue.PatternFill = 0] = "PatternFill", Ue[Ue.SolidFill = 1] = "SolidFill";
(He = {})[He.NonAssociative = 0] = "NonAssociative", He[He.Associative = 1] = "Associative";
(ve = {})[ve.Normal = 0] = "Normal", ve[ve.Outer = 1] = "Outer", ve[ve.Ignore = 2] = "Ignore";
(Se = {})[Se.UserDefined = 0] = "UserDefined", Se[Se.Predefined = 1] = "Predefined", Se[Se.Custom = 2] = "Custom";
(Ge = {})[Ge.NotAnnotated = 0] = "NotAnnotated", Ge[Ge.Annotated = 1] = "Annotated";
(We = {})[We.Solid = 0] = "Solid", We[We.Gradient = 1] = "Gradient";
(je = {})[je.TwoColor = 0] = "TwoColor", je[je.OneColor = 1] = "OneColor";
var gn = ((H = {})[H.Default = 0] = "Default", H[H.External = 1] = "External", H[H.Polyline = 2] = "Polyline", H[H.Derived = 4] = "Derived", H[H.Textbox = 8] = "Textbox", H[H.Outermost = 16] = "Outermost", H), nr = ((re = {})[re.Line = 1] = "Line", re[re.Circular = 2] = "Circular", re[re.Elliptic = 3] = "Elliptic", re[re.Spline = 4] = "Spline", re), xn = ((T = {})[T.Off = 0] = "Off", T[T.Solid = 1] = "Solid", T[T.Dashed = 2] = "Dashed", T[T.Dotted = 3] = "Dotted", T[T.ShotDash = 4] = "ShotDash", T[T.MediumDash = 5] = "MediumDash", T[T.LongDash = 6] = "LongDash", T[T.DoubleShortDash = 7] = "DoubleShortDash", T[T.DoubleMediumDash = 8] = "DoubleMediumDash", T[T.DoubleLongDash = 9] = "DoubleLongDash", T[T.DoubleMediumLongDash = 10] = "DoubleMediumLongDash", T[T.SparseDot = 11] = "SparseDot", T);
xn.Off;
(Te = {})[Te.Standard = -3] = "Standard", Te[Te.ByLayer = -2] = "ByLayer", Te[Te.ByBlock = -1] = "ByBlock";
(Ye = {})[Ye.English = 0] = "English", Ye[Ye.Metric = 1] = "Metric";
(I = {})[I.PERSPECTIVE_MODE = 1] = "PERSPECTIVE_MODE", I[I.FRONT_CLIPPING = 2] = "FRONT_CLIPPING", I[I.BACK_CLIPPING = 4] = "BACK_CLIPPING", I[I.UCS_FOLLOW = 8] = "UCS_FOLLOW", I[I.FRONT_CLIP_NOT_AT_EYE = 16] = "FRONT_CLIP_NOT_AT_EYE", I[I.UCS_ICON_VISIBILITY = 32] = "UCS_ICON_VISIBILITY", I[I.UCS_ICON_AT_ORIGIN = 64] = "UCS_ICON_AT_ORIGIN", I[I.FAST_ZOOM = 128] = "FAST_ZOOM", I[I.SNAP_MODE = 256] = "SNAP_MODE", I[I.GRID_MODE = 512] = "GRID_MODE", I[I.ISOMETRIC_SNAP_STYLE = 1024] = "ISOMETRIC_SNAP_STYLE", I[I.HIDE_PLOT_MODE = 2048] = "HIDE_PLOT_MODE", I[I.K_ISO_PAIR_TOP = 4096] = "K_ISO_PAIR_TOP", I[I.K_ISO_PAIR_RIGHT = 8192] = "K_ISO_PAIR_RIGHT", I[I.VIEWPORT_ZOOM_LOCKING = 16384] = "VIEWPORT_ZOOM_LOCKING", I[I.UNUSED = 32768] = "UNUSED", I[I.NON_RECTANGULAR_CLIPPING = 65536] = "NON_RECTANGULAR_CLIPPING", I[I.VIEWPORT_OFF = 131072] = "VIEWPORT_OFF", I[I.GRID_BEYOND_DRAWING_LIMITS = 262144] = "GRID_BEYOND_DRAWING_LIMITS", I[I.ADAPTIVE_GRID_DISPLAY = 524288] = "ADAPTIVE_GRID_DISPLAY", I[I.SUBDIVISION_BELOW_SPACING = 1048576] = "SUBDIVISION_BELOW_SPACING", I[I.GRID_FOLLOWS_WORKPLANE = 2097152] = "GRID_FOLLOWS_WORKPLANE";
(P = {})[P.OPTIMIZED_2D = 0] = "OPTIMIZED_2D", P[P.WIREFRAME = 1] = "WIREFRAME", P[P.HIDDEN_LINE = 2] = "HIDDEN_LINE", P[P.FLAT_SHADED = 3] = "FLAT_SHADED", P[P.GOURAUD_SHADED = 4] = "GOURAUD_SHADED", P[P.FLAT_SHADED_WITH_WIREFRAME = 5] = "FLAT_SHADED_WITH_WIREFRAME", P[P.GOURAUD_SHADED_WITH_WIREFRAME = 6] = "GOURAUD_SHADED_WITH_WIREFRAME";
(Xe = {})[Xe.UCS_UNCHANGED = 0] = "UCS_UNCHANGED", Xe[Xe.HAS_OWN_UCS = 1] = "HAS_OWN_UCS";
(B = {})[B.NON_ORTHOGRAPHIC = 0] = "NON_ORTHOGRAPHIC", B[B.TOP = 1] = "TOP", B[B.BOTTOM = 2] = "BOTTOM", B[B.FRONT = 3] = "FRONT", B[B.BACK = 4] = "BACK", B[B.LEFT = 5] = "LEFT", B[B.RIGHT = 6] = "RIGHT";
(ze = {})[ze.ONE_DISTANT_LIGHT = 0] = "ONE_DISTANT_LIGHT", ze[ze.TWO_DISTANT_LIGHTS = 1] = "TWO_DISTANT_LIGHTS";
(ae = {})[ae.ByLayer = 0] = "ByLayer", ae[ae.ByBlock = 1] = "ByBlock", ae[ae.ByDictionaryDefault = 2] = "ByDictionaryDefault", ae[ae.ByObject = 3] = "ByObject";
(x = {})[x.NotAllowed = 0] = "NotAllowed", x[x.AllowErase = 1] = "AllowErase", x[x.AllowTransform = 2] = "AllowTransform", x[x.AllowChangeColor = 4] = "AllowChangeColor", x[x.AllowChangeLayer = 8] = "AllowChangeLayer", x[x.AllowChangeLinetype = 16] = "AllowChangeLinetype", x[x.AllowChangeLinetypeScale = 32] = "AllowChangeLinetypeScale", x[x.AllowChangeVisibility = 64] = "AllowChangeVisibility", x[x.AllowClone = 128] = "AllowClone", x[x.AllowChangeLineweight = 256] = "AllowChangeLineweight", x[x.AllowChangePlotStyleName = 512] = "AllowChangePlotStyleName", x[x.AllowAllExceptClone = 895] = "AllowAllExceptClone", x[x.AllowAll = 1023] = "AllowAll", x[x.DisableProxyWarning = 1024] = "DisableProxyWarning", x[x.R13FormatProxy = 32768] = "R13FormatProxy";
function h(e, n, a) {
  return e.code === n && (a == null || e.value === a);
}
function he(e) {
  let n = {};
  e.rewind();
  let a = e.next(), t = a.code;
  if (n.x = a.value, (a = e.next()).code !== t + 10) throw Error("Expected code for point value to be 20 but got " + a.code + ".");
  return n.y = a.value, (a = e.next()).code !== t + 20 ? e.rewind() : n.z = a.value, n;
}
let ar = Symbol();
function p(e, n) {
  return (a, t, s) => {
    let o = function(d, l = !1) {
      return d.reduce((m, b) => {
        b.pushContext && m.push({});
        let y = m[m.length - 1];
        for (let g of typeof b.code == "number" ? [b.code] : b.code) {
          let S = y[g] ?? (y[g] = []);
          b.isMultiple && S.length, S.push(b);
        }
        return m;
      }, [{}]);
    }(e, t.debug), c = !1, f = o.length - 1;
    for (; !h(a, 0, "EOF"); ) {
      let d = function(A, w, V) {
        return A.find((Pe, F) => {
          var _;
          return F >= V && ((_ = Pe[w]) == null ? void 0 : _.length);
        });
      }(o, a.code, f), l = d == null ? void 0 : d[a.code], m = l == null ? void 0 : l[l.length - 1];
      if (!d || !m) {
        t.rewind();
        break;
      }
      m.isMultiple || d[a.code].pop();
      let { name: b, parser: y, isMultiple: g, isReducible: S } = m, v = y == null ? void 0 : y(a, t, s);
      if (v === ar) {
        t.rewind();
        break;
      }
      if (b) {
        let [A, w] = yn(s, b);
        g && !S ? (Object.prototype.hasOwnProperty.call(A, w) || (A[w] = []), A[w].push(v)) : A[w] = v;
      }
      m.pushContext && (f -= 1), c = !0, a = t.next();
    }
    return n && Object.setPrototypeOf(s, n), c;
  };
}
function yn(e, n) {
  let a = n.split(".");
  if (!a.length) throw Error("[parserGenerator::getObjectByPath] Invalid empty path");
  let t = e;
  for (let s = 0; s < a.length - 1; ++s) {
    let o = Lr(a[s]), c = Lr(a[s + 1]);
    Object.prototype.hasOwnProperty.call(t, o) || (typeof c == "number" ? t[o] = [] : t[o] = {}), t = t[o];
  }
  return [t, Lr(a[a.length - 1])];
}
function Lr(e) {
  let n = Number.parseInt(e);
  return Number.isNaN(n) ? e : n;
}
function r({ value: e }) {
  return e;
}
function i(e, n) {
  return he(n);
}
function u({ value: e }) {
  return !!e;
}
function vn({ value: e }) {
  return e.trim();
}
let Sn = [{ code: 281, name: "isEntity", parser: u }, { code: 280, name: "wasProxy", parser: u }, { code: 91, name: "instanceCount", parser: r }, { code: 90, name: "proxyFlag", parser: r }, { code: 3, name: "appName", parser: r }, { code: 2, name: "cppClassName", parser: r }, { code: 1, name: "name", parser: r }], Tn = p(Sn), On = [{ code: 0, name: "classes", isMultiple: !0, parser(e, n) {
  if (e.value !== "CLASS") return ar;
  e = n.next();
  let a = {};
  return Tn(e, n, a), a;
} }], Nn = p(On);
(Ke = {})[Ke.RayTrace = 0] = "RayTrace", Ke[Ke.ShadowMap = 1] = "ShadowMap";
function J(e, n, a) {
  for (; h(e, 102); ) {
    var t;
    let s = e.value;
    if (e = n.next(), !s.startsWith("{")) {
      n.debug, function(c, f) {
        for (; !h(c, 102) && !h(c, 0, "EOF"); ) c = f.next();
      }(e, n), e = n.next();
      continue;
    }
    let o = s.slice(1).trim();
    a.extensions ?? (a.extensions = {}), (t = a.extensions)[o] ?? (t[o] = []), function(c, f, d) {
      for (; !h(c, 102, "}") && !h(c, 0, "EOF"); ) d.push(c), c = f.next();
    }(e, n, a.extensions[o]), e = n.next();
  }
  n.rewind();
}
let An = [{ code: 1001, name: "xdata", isMultiple: !0, parser: Fr }], Dn = /* @__PURE__ */ new Set([1010, 1011, 1012, 1013]);
function Fr(e, n) {
  var s;
  if (!h(e, 1001)) throw Error("XData must starts with code 1001");
  let a = { appName: e.value, value: [] };
  e = n.next();
  let t = [a.value];
  for (; !h(e, 0, "EOF") && !h(e, 1001) && e.code >= 1e3; ) {
    let o = t[t.length - 1];
    if (e.code === 1002) {
      e.value === "{" ? t.push([]) : (t.pop(), (s = t[t.length - 1]) == null || s.push(o)), e = n.next();
      continue;
    }
    Dn.has(e.code) ? o.push(he(n)) : o.push(e.value), e = n.next();
  }
  return n.rewind(), a;
}
class cr {
  parseEntity(n, a) {
    let t = {}, s = "none", o = !1;
    for (; !h(a, 0, "EOF"); ) {
      switch (a.code) {
        case 100:
          a.value === "AcDbProxyEntity" && (t.subclassMarker = "AcDbProxyEntity", o = !0);
          break;
        case 90:
          t.proxyEntityClassId = a.value, s = "none";
          break;
        case 91:
          t.applicationEntityClassId = a.value, s = "none";
          break;
        case 1:
          o && (t.originalDxfName = String(a.value));
          break;
        case 92:
        case 160:
          t.graphicsDataSize = a.value, s = "graphics";
          break;
        case 93:
        case 161:
          t.entityDataSize = a.value, s = "entity";
          break;
        case 96:
        case 162:
          t.unknownDataSize = a.value, s = "unknown";
          break;
        case 310:
          s === "graphics" ? t.graphicsData = (t.graphicsData ?? "") + a.value : s === "entity" && (t.entityData = (t.entityData ?? "") + a.value);
          break;
        case 311:
          s === "unknown" && (t.unknownData = (t.unknownData ?? "") + a.value);
          break;
        case 330:
        case 340:
        case 350:
        case 360:
          s = "none", o ? (t.linkedObjectIds ?? (t.linkedObjectIds = [])).push(String(a.value)) : a.code === 330 && (t.ownerBlockRecordSoftId = String(a.value));
          break;
        case 94:
          s = "none";
          break;
        case 95:
          t.objectDrawingFormat = a.value;
          break;
        case 70:
          t.originalDataFormat = a.value;
          break;
        case 5:
          t.handle = String(a.value);
          break;
        case 102:
          J(a, n, t);
          break;
        case 67:
          t.isInPaperSpace = !!a.value;
          break;
        case 8:
          t.layer = String(a.value);
          break;
        case 6:
          t.lineType = String(a.value);
          break;
        case 347:
          t.materialObjectHardId = String(a.value);
          break;
        case 62:
          t.colorIndex = a.value;
          break;
        case 370:
          t.lineweight = a.value;
          break;
        case 48:
          t.lineTypeScale = a.value;
          break;
        case 60:
          t.isVisible = !!a.value;
          break;
        case 420:
          t.color = a.value;
          break;
        case 430:
          t.colorName = String(a.value);
          break;
        case 440:
          t.transparency = a.value;
          break;
        case 380:
          t.plotStyleType = a.value;
          break;
        case 390:
          t.plotStyleHardId = String(a.value);
          break;
        case 284:
          t.shadowMode = a.value;
          break;
        case 410:
          t.layoutTabName = String(a.value);
          break;
        case 1001:
          (t.xdata ?? (t.xdata = [])).push(Fr(a, n));
          break;
        default:
          return n.rewind(), t;
      }
      a = n.next();
    }
    return n.rewind(), t;
  }
}
(vr = "ForEntityName") in cr ? Object.defineProperty(cr, vr, { value: "ACAD_PROXY_ENTITY", enumerable: !0, configurable: !0, writable: !0 }) : cr[vr] = "ACAD_PROXY_ENTITY";
(Sr = {})[Sr.ProxyEntity = 498] = "ProxyEntity";
(Ze = {})[Ze.Dwg = 0] = "Dwg", Ze[Ze.Dxf = 1] = "Dxf";
(ne = {})[ne.CAST_AND_RECEIVE = 0] = "CAST_AND_RECEIVE", ne[ne.CAST = 1] = "CAST", ne[ne.RECEIVE = 2] = "RECEIVE", ne[ne.IGNORE = 3] = "IGNORE";
let E = [...An, { code: 284, name: "shadowMode", parser: r }, { code: 390, name: "plotStyleHardId", parser: r }, { code: 380, name: "plotStyleType", parser: r }, { code: 440, name: "transparency", parser: r }, { code: 430, name: "colorName", parser: r }, { code: 420, name: "color", parser: r }, { code: 310, name: "proxyEntity", isMultiple: !0, isReducible: !0, parser: (e, n, a) => (a.proxyEntity ?? "") + e.value }, { code: [92, 160], name: "proxyByte", parser: r }, { code: 60, name: "isVisible", parser: u }, { code: 48, name: "lineTypeScale", parser: r }, { code: 370, name: "lineweight", parser: r }, { code: 62, name: "colorIndex", parser: r }, { code: 347, name: "materialObjectHardId", parser: r }, { code: 6, name: "lineType", parser: r }, { code: 8, name: "layer", parser: r }, { code: 410, name: "layoutTabName", parser: r }, { code: 67, name: "isInPaperSpace", parser: u }, { code: 100 }, { code: 330, name: "ownerBlockRecordSoftId", parser: r }, { code: 102, parser: J }, { code: 102, parser: J }, { code: 102, parser: J }, { code: 5, name: "handle", parser: r }];
function hr(e) {
  return [{ code: 3, name: e, parser: (n, a, t) => (t._code3text = (t._code3text ?? "") + n.value, t._code3text + (t._code1text ?? "")), isMultiple: !0, isReducible: !0 }, { code: 1, name: e, parser: (n, a, t) => (t._code1text = n.value, (t._code3text ?? "") + t._code1text) }];
}
function Xr(e, n, a) {
  return n in e ? Object.defineProperty(e, n, { value: a, enumerable: !0, configurable: !0, writable: !0 }) : e[n] = a, e;
}
let kn = { extrusionDirection: { x: 0, y: 0, z: 1 } }, Ln = [{ code: 210, name: "extrusionDirection", parser: i }, { code: 51, name: "endAngle", parser: r }, { code: 50, name: "startAngle", parser: r }, { code: 100, name: "subclassMarker", parser: r }, { code: 40, name: "radius", parser: r }, { code: 10, name: "center", parser: i }, { code: 39, name: "thickness", parser: r }, { code: 100 }, ...E];
class zr {
  parseEntity(n, a) {
    let t = {};
    return this.parser(a, n, t), t;
  }
  constructor() {
    Xr(this, "parser", p(Ln, kn));
  }
}
Xr(zr, "ForEntityName", "ARC");
(Oe = {})[Oe.BeforeText = 0] = "BeforeText", Oe[Oe.AboveText = 1] = "AboveText", Oe[Oe.None = 2] = "None";
let Rr = [{ name: "DIMPOST", code: 3 }, { name: "DIMAPOST", code: 4, defaultValue: "" }, { name: "DIMBLK_OBSOLETE", code: 5 }, { name: "DIMBLK1_OBSOLETE", code: 6 }, { name: "DIMBLK2_OBSOLETE", code: 7 }, { name: "DIMSCALE", code: 40, defaultValue: 1 }, { name: "DIMASZ", code: 41, defaultValue: 0.25 }, { name: "DIMEXO", code: 42, defaultValue: 0.625, defaultValueImperial: 0.0625 }, { name: "DIMDLI", code: 43, defaultValue: 3.75, defaultValueImperial: 0.38 }, { name: "DIMEXE", code: 44, defaultValue: 2.25, defaultValueImperial: 0.28 }, { name: "DIMRND", code: 45, defaultValue: 0 }, { name: "DIMDLE", code: 46, defaultValue: 0 }, { name: "DIMTP", code: 47, defaultValue: 0 }, { name: "DIMTM", code: 48, defaultValue: 0 }, { name: "DIMFXL", code: 49, defaultValue: 1 }, { name: "DIMJOGANG", code: 50, defaultValue: 45 }, { name: "DIMTFILL", code: 69, defaultValue: 0 }, { name: "DIMTFILLCLR", code: 70, defaultValue: 0 }, { name: "DIMTOL", code: 71, defaultValue: 0, defaultValueImperial: 1 }, { name: "DIMLIM", code: 72, defaultValue: 0 }, { name: "DIMTIH", code: 73, defaultValue: 0, defaultValueImperial: 1 }, { name: "DIMTOH", code: 74, defaultValue: 0, defaultValueImperial: 1 }, { name: "DIMSE1", code: 75, defaultValue: 0 }, { name: "DIMSE2", code: 76, defaultValue: 0 }, { name: "DIMTAD", code: 77, defaultValue: Ur.Above, defaultValueImperial: Ur.Center }, { name: "DIMZIN", code: 78, defaultValue: Fe.Trailing, defaultValueImperial: Fe.Feet }, { name: "DIMAZIN", code: 79, defaultValue: In.None }, { name: "DIMARCSYM", code: 90, defaultValue: 0 }, { name: "DIMTXT", code: 140, defaultValue: 2.5, defaultValueImperial: 0.28 }, { name: "DIMCEN", code: 141, defaultValue: 2.5, defaultValueImperial: 0.09 }, { name: "DIMTSZ", code: 142, defaultValue: 0 }, { name: "DIMALTF", code: 143, defaultValue: 25.4 }, { name: "DIMLFAC", code: 144, defaultValue: 1 }, { name: "DIMTVP", code: 145, defaultValue: 0 }, { name: "DIMTFAC", code: 146, defaultValue: 1 }, { name: "DIMGAP", code: 147, defaultValue: 0.625, defaultValueImperial: 0.09 }, { name: "DIMALTRND", code: 148, defaultValue: 0 }, { name: "DIMALT", code: 170, defaultValue: 0 }, { name: "DIMALTD", code: 171, defaultValue: 3, defaultValueImperial: 2 }, { name: "DIMTOFL", code: 172, defaultValue: 1, defaultValueImperial: 0 }, { name: "DIMSAH", code: 173, defaultValue: 0 }, { name: "DIMTIX", code: 174, defaultValue: 0 }, { name: "DIMSOXD", code: 175, defaultValue: 0 }, { name: "DIMCLRD", code: 176, defaultValue: 0 }, { name: "DIMCLRE", code: 177, defaultValue: 0 }, { name: "DIMCLRT", code: 178, defaultValue: 0 }, { name: "DIMADEC", code: 179, defaultValue: 0 }, { name: "DIMUNIT", code: 270 }, { name: "DIMDEC", code: 271, defaultValue: 2, defaultValueImperial: 4 }, { name: "DIMTDEC", code: 272, defaultValue: 2, defaultValueImperial: 4 }, { name: "DIMALTU", code: 273, defaultValue: 2 }, { name: "DIMALTTD", code: 274, defaultValue: 3, defaultValueImperial: 2 }, { name: "DIMAUNIT", code: 275, defaultValue: 0 }, { name: "DIMFRAC", code: 276, defaultValue: 0 }, { name: "DIMLUNIT", code: 277, defaultValue: 2 }, { name: "DIMDSEP", code: 278, defaultValue: 44, defaultValueImperial: 46 }, { name: "DIMTMOVE", code: 279, defaultValue: 0 }, { name: "DIMJUST", code: 280, defaultValue: hn.Center }, { name: "DIMSD1", code: 281, defaultValue: 0 }, { name: "DIMSD2", code: 282, defaultValue: 0 }, { name: "DIMTOLJ", code: 283, defaultValue: En.Center }, { name: "DIMTZIN", code: 284, defaultValue: Fe.Trailing, defaultValueImperial: Fe.Feet }, { name: "DIMALTZ", code: 285, defaultValue: Fe.Trailing }, { name: "DIMALTTZ", code: 286, defaultValue: Fe.Trailing }, { name: "DIMFIT", code: 287 }, { name: "DIMUPT", code: 288, defaultValue: 0 }, { name: "DIMATFIT", code: 289, defaultValue: 3 }, { name: "DIMFXLON", code: 290, defaultValue: 0 }, { name: "DIMTXTDIRECTION", code: 294, defaultValue: 0 }, { name: "DIMTXSTY", code: 340, defaultValue: "Standard" }, { name: "DIMLDRBLK", code: 341, defaultValue: "" }, { name: "DIMBLK", code: 342, defaultValue: "" }, { name: "DIMBLK1", code: 343, defaultValue: "" }, { name: "DIMBLK2", code: 344, defaultValue: "" }, { name: "DIMLTYPE", code: 345, defaultValue: "" }, { name: "DIMLTEX1", code: 346, defaultValue: "" }, { name: "DIMLTEX2", code: 347, defaultValue: "" }, { name: "DIMLWD", code: 371, defaultValue: -2 }, { name: "DIMLWE", code: 372, defaultValue: -2 }], Kr = [{ code: 3, name: "styleName", parser: r }, { code: 210, name: "extrusionDirection", parser: i }, { code: 51, name: "ocsRotation", parser: r }, { code: 53, name: "textRotation", parser: r }, { code: 1, name: "text", parser: r }, { code: 42, name: "measurement", parser: r }, { code: 72, name: "textLineSpacingStyle", parser: r }, { code: 71, name: "attachmentPoint", parser: r }, { code: 70, name: "dimensionType", parser: r }, { code: 11, name: "textPoint", parser: i }, { code: 10, name: "definitionPoint", parser: i }, { code: 2, name: "name", parser: r }, { code: 280, name: "version", parser: r }, { code: 100 }], Cn = [{ code: 100 }, { code: 52, name: "obliqueAngle", parser: r }, { code: 50, name: "rotationAngle", parser: r }, { code: 14, name: "subDefinitionPoint2", parser: i }, { code: 13, name: "subDefinitionPoint1", parser: i }, { code: 12, name: "insertionPoint", parser: i }, { code: 100, name: "subclassMarker", parser: r }], Mn = [{ code: 16, name: "arcPoint", parser: i }, { code: 15, name: "centerPoint", parser: i }, { code: 14, name: "subDefinitionPoint2", parser: i }, { code: 13, name: "subDefinitionPoint1", parser: i }, { code: 100, name: "subclassMarker", parser: r }], wn = [{ code: 14, name: "subDefinitionPoint2", parser: i }, { code: 13, name: "subDefinitionPoint1", parser: i }, { code: 100, name: "subclassMarker", parser: r }], _n = [{ code: 40, name: "leaderLength", parser: r }, { code: 15, name: "subDefinitionPoint", parser: i }, { code: 100, name: "subclassMarker", parser: r }], Fn = [{ code: 100, parser(e, n, a) {
  let t = function(s) {
    switch (s) {
      case "AcDbAlignedDimension":
        return p(Cn);
      case "AcDb3PointAngularDimension":
      case "AcDb2LineAngularDimension":
        return p(Mn);
      case "AcDbOrdinateDimension":
        return p(wn);
      case "AcDbRadialDimension":
      case "AcDbDiametricDimension":
        return p(_n);
    }
    return null;
  }(e.value);
  if (!t) return ar;
  t(e, n, a);
}, pushContext: !0 }, ...Rr.map((e) => ({ ...e, parser: r })), ...Kr, ...E];
class lr {
  parseEntity(n, a) {
    let t = {};
    return p(Fn)(a, n, t), t;
  }
}
(Tr = "ForEntityName") in lr ? Object.defineProperty(lr, Tr, { value: "DIMENSION", enumerable: !0, configurable: !0, writable: !0 }) : lr[Tr] = "DIMENSION";
let Rn = [{ code: 73 }, { code: 17, name: "leaderEnd", parser: i }, { code: 16, name: "leaderStart", parser: i }, { code: 71, name: "hasLeader", parser: u }, { code: 41, name: "endAngle", parser: r }, { code: 40, name: "startAngle", parser: r }, { code: 70, name: "isPartial", parser: u }, { code: 15, name: "centerPoint", parser: i }, { code: 14, name: "xline2Point", parser: i }, { code: 13, name: "xline1Point", parser: i }, { code: 100, name: "subclassMarker", parser: r, pushContext: !0 }, ...Rr.map((e) => ({ ...e, parser: r })), ...Kr, ...E];
class dr {
  parseEntity(n, a) {
    let t = {};
    return p(Rn)(a, n, t), t;
  }
}
(Or = "ForEntityName") in dr ? Object.defineProperty(dr, Or, { value: "ARC_DIMENSION", enumerable: !0, configurable: !0, writable: !0 }) : dr[Or] = "ARC_DIMENSION";
($ = {})[$.NONE = 0] = "NONE", $[$.INVISIBLE = 1] = "INVISIBLE", $[$.CONSTANT = 2] = "CONSTANT", $[$.VERIFICATION_REQUIRED = 4] = "VERIFICATION_REQUIRED", $[$.PRESET = 8] = "PRESET";
($e = {})[$e.MULTILINE = 2] = "MULTILINE", $e[$e.CONSTANT_MULTILINE = 4] = "CONSTANT_MULTILINE";
(Ne = {})[Ne.NONE = 0] = "NONE", Ne[Ne.MIRRORED_X = 2] = "MIRRORED_X", Ne[Ne.MIRRORED_Y = 4] = "MIRRORED_Y";
var Pn = ((G = {})[G.LEFT = 0] = "LEFT", G[G.CENTER = 1] = "CENTER", G[G.RIGHT = 2] = "RIGHT", G[G.ALIGNED = 3] = "ALIGNED", G[G.MIDDLE = 4] = "MIDDLE", G[G.FIT = 5] = "FIT", G), Bn = ((te = {})[te.BASELINE = 0] = "BASELINE", te[te.BOTTOM = 1] = "BOTTOM", te[te.MIDDLE = 2] = "MIDDLE", te[te.TOP = 3] = "TOP", te);
function Zr(e, n, a) {
  return n in e ? Object.defineProperty(e, n, { value: a, enumerable: !0, configurable: !0, writable: !0 }) : e[n] = a, e;
}
let $r = { thickness: 0, rotation: 0, xScale: 1, obliqueAngle: 0, styleName: "STANDARD", generationFlag: 0, halign: Pn.LEFT, valign: Bn.BASELINE, extrusionDirection: { x: 0, y: 0, z: 1 } }, Jr = [{ code: 73, name: "valign", parser: r }, { code: 100 }, { code: 210, name: "extrusionDirection", parser: i }, { code: 11, name: "endPoint", parser: i }, { code: 72, name: "valign", parser: r }, { code: 72, name: "halign", parser: r }, { code: 71, name: "generationFlag", parser: r }, { code: 7, name: "styleName", parser: r }, { code: 51, name: "obliqueAngle", parser: r }, { code: 41, name: "xScale", parser: r }, { code: 50, name: "rotation", parser: r }, { code: 1, name: "text", parser: r }, { code: 40, name: "textHeight", parser: r }, { code: 10, name: "startPoint", parser: i }, { code: 39, name: "thickness", parser: r }, { code: 100, name: "subclassMarker", parser: r }, ...E];
class qr {
  parseEntity(n, a) {
    let t = {};
    return this.parser(a, n, t), t;
  }
  constructor() {
    Zr(this, "parser", p(Jr, $r));
  }
}
function Qr(e, n, a) {
  return n in e ? Object.defineProperty(e, n, { value: a, enumerable: !0, configurable: !0, writable: !0 }) : e[n] = a, e;
}
Zr(qr, "ForEntityName", "TEXT");
let Vn = { ...$r }, Un = [{ code: 2 }, { code: 40, name: "annotationScale", parser: r }, { code: 10, name: "alignmentPoint", parser: i }, { code: 340, name: "secondaryAttributesHardIds", isMultiple: !0, parser: r }, { code: 70, name: "numberOfSecondaryAttributes", parser: r }, { code: 70, name: "isReallyLocked", parser: u }, { code: 70, name: "mtextFlag", parser: r }, { code: 280, name: "isDuplicatedRecord", parser: u }, { code: 100 }, { code: 280, name: "isLocked", parser: u }, { code: 74, name: "valign", parser: r }, { code: 73 }, { code: 70, name: "attributeFlag", parser: r }, { code: 2, name: "tag", parser: r }, { code: 3, name: "prompt", parser: r }, { code: 280 }, { code: 100, name: "subclassMarker", parser: r }, ...Jr.slice(2)];
class ea {
  parseEntity(n, a) {
    let t = {};
    return this.parser(a, n, t), t;
  }
  constructor() {
    Qr(this, "parser", p(Un, Vn));
  }
}
function Hn(e, n) {
  let a = {};
  for (let t of e) {
    let s = n(t);
    s != null && (a[s] ?? (a[s] = []), a[s].push(t));
  }
  return a;
}
function* Ir(e, n = 1 / 0, a = 1) {
  for (let t = e; t !== n; t += a) yield t;
}
function wr(e) {
  return { x: e.x ?? 0, y: e.y ?? 0, z: e.z ?? 0 };
}
Qr(ea, "ForEntityName", "ATTDEF");
var Gn = [0, 16711680, 16776960, 65280, 65535, 255, 16711935, 16777215, 8421504, 12632256, 16711680, 16744319, 13369344, 13395558, 10027008, 10046540, 8323072, 8339263, 4980736, 4990502, 16727808, 16752511, 13382400, 13401958, 10036736, 10051404, 8331008, 8343359, 4985600, 4992806, 16744192, 16760703, 13395456, 13408614, 10046464, 10056268, 8339200, 8347455, 4990464, 4995366, 16760576, 16768895, 13408512, 13415014, 10056192, 10061132, 8347392, 8351551, 4995328, 4997670, 16776960, 16777087, 13421568, 13421670, 10000384, 10000460, 8355584, 8355647, 5000192, 5000230, 12582656, 14679935, 10079232, 11717734, 7510016, 8755276, 6258432, 7307071, 3755008, 4344870, 8388352, 12582783, 6736896, 10079334, 5019648, 7510092, 4161280, 6258495, 2509824, 3755046, 4194048, 10485631, 3394560, 8375398, 2529280, 6264908, 2064128, 5209919, 1264640, 3099686, 65280, 8388479, 52224, 6736998, 38912, 5019724, 32512, 4161343, 19456, 2509862, 65343, 8388511, 52275, 6737023, 38950, 5019743, 32543, 4161359, 19475, 2509871, 65407, 8388543, 52326, 6737049, 38988, 5019762, 32575, 4161375, 19494, 2509881, 65471, 8388575, 52377, 6737074, 39026, 5019781, 32607, 4161391, 19513, 2509890, 65535, 8388607, 52428, 6737100, 39064, 5019800, 32639, 4161407, 19532, 2509900, 49151, 8380415, 39372, 6730444, 29336, 5014936, 24447, 4157311, 14668, 2507340, 32767, 8372223, 26316, 6724044, 19608, 5010072, 16255, 4153215, 9804, 2505036, 16383, 8364031, 13260, 6717388, 9880, 5005208, 8063, 4149119, 4940, 2502476, 255, 8355839, 204, 6710988, 152, 5000344, 127, 4145023, 76, 2500172, 4129023, 10452991, 3342540, 8349388, 2490520, 6245528, 2031743, 5193599, 1245260, 3089996, 8323327, 12550143, 6684876, 10053324, 4980888, 7490712, 4128895, 6242175, 2490444, 3745356, 12517631, 14647295, 10027212, 11691724, 7471256, 8735896, 6226047, 7290751, 3735628, 4335180, 16711935, 16744447, 13369548, 13395660, 9961624, 9981080, 8323199, 8339327, 4980812, 4990540, 16711871, 16744415, 13369497, 13395634, 9961586, 9981061, 8323167, 8339311, 4980793, 4990530, 16711807, 16744383, 13369446, 13395609, 9961548, 9981042, 8323135, 8339295, 4980774, 4990521, 16711743, 16744351, 13369395, 13395583, 9961510, 9981023, 8323103, 8339279, 4980755, 4990511, 3355443, 5987163, 8684676, 11382189, 14079702, 16777215];
function Wn(e) {
  return Gn[e];
}
function jn(e) {
  e.rewind();
  let n = e.next();
  if (n.code !== 101) throw Error("Bad call for skipEmbeddedObject()");
  do
    n = e.next();
  while (n.code !== 0);
  e.rewind();
}
function Yn(e, n, a) {
  if (h(n, 102)) return J(n, a, e), !0;
  switch (n.code) {
    case 0:
      e.type = n.value;
      break;
    case 5:
      e.handle = n.value;
      break;
    case 330:
      e.ownerBlockRecordSoftId = n.value;
      break;
    case 67:
      e.isInPaperSpace = !!n.value;
      break;
    case 8:
      e.layer = n.value;
      break;
    case 6:
      e.lineType = n.value;
      break;
    case 347:
      e.materialObjectHardId = n.value;
      break;
    case 62:
      e.colorIndex = n.value, e.color = Wn(Math.abs(n.value));
      break;
    case 370:
      e.lineweight = n.value;
      break;
    case 48:
      e.lineTypeScale = n.value;
      break;
    case 60:
      e.isVisible = !!n.value;
      break;
    case 92:
      e.proxyByte = n.value;
      break;
    case 310:
      e.proxyEntity = n.value;
      break;
    case 100:
      break;
    case 420:
      e.color = n.value;
      break;
    case 430:
      e.transparency = n.value;
      break;
    case 390:
      e.plotStyleHardId = n.value;
      break;
    case 284:
      e.shadowMode = n.value;
      break;
    case 1001:
      (e.xdata ?? (e.xdata = [])).push(Fr(n, a));
      break;
    default:
      return !1;
  }
  return !0;
}
function ra(e, n, a) {
  return n in e ? Object.defineProperty(e, n, { value: a, enumerable: !0, configurable: !0, writable: !0 }) : e[n] = a, e;
}
let Xn = { textStyle: "STANDARD", extrusionDirection: { x: 0, y: 0, z: 1 }, rotation: 0 }, ur = [{ code: 46, name: "annotationHeight", parser: r }, { code: 101, parser(e, n) {
  jn(n);
} }, { code: 50, name: "columnHeight", parser: r }, { code: 49, name: "columnGutter", parser: r }, { code: 48, name: "columnWidth", parser: r }, { code: 79, name: "columnAutoHeight", parser: r }, { code: 78, name: "columnFlowReversed", parser: r }, { code: 76, name: "columnCount", parser: r }, { code: 75, name: "columnType", parser: r }, { code: 441, name: "backgroundFillTransparency", parser: r }, { code: 63, name: "backgroundFillColor", parser: r }, { code: 45, name: "fillBoxScale", parser: r }, { code: [...Ir(430, 440)], name: "backgroundColor", parser: r }, { code: [...Ir(420, 430)], name: "backgroundColor", parser: r }, { code: 90, name: "backgroundFill", parser: r }, { code: 44, name: "lineSpacing", parser: r }, { code: 73, name: "lineSpacingStyle", parser: r }, { code: 50, name: "rotation", parser: r }, { code: 43 }, { code: 42 }, { code: 11, name: "direction", parser: i }, { code: 210, name: "extrusionDirection", parser: i }, { code: 7, name: "styleName", parser: r }, ...hr("text"), { code: 72, name: "drawingDirection", parser: r }, { code: 71, name: "attachmentPoint", parser: r }, { code: 41, name: "width", parser: r }, { code: 40, name: "height", parser: r }, { code: 10, name: "insertionPoint", parser: i }, { code: 100, name: "subclassMarker", parser: r }, ...E];
class aa {
  parseEntity(n, a) {
    let t = {};
    return this.parser(a, n, t), t;
  }
  constructor() {
    ra(this, "parser", p(ur, Xn));
  }
}
function na(e, n, a) {
  return n in e ? Object.defineProperty(e, n, { value: a, enumerable: !0, configurable: !0, writable: !0 }) : e[n] = a, e;
}
ra(aa, "ForEntityName", "MTEXT");
let zn = { thickness: 0, rotation: 0, scale: 1, obliqueAngle: 0, textStyle: "STANDARD", textGenerationFlag: 0, horizontalJustification: 0, verticalJustification: 0, extrusionDirection: { x: 0, y: 0, z: 1 } }, Kn = [...ur.slice(ur.findIndex(({ name: e }) => e === "columnType"), ur.findIndex(({ name: e }) => e === "subclassMarker") + 1), { code: 100 }, { code: 0, parser(e) {
  if (!h(e, 0, "MTEXT")) return ar;
} }, { code: 2, name: "definitionTag", parser: r }, { code: 40, name: "annotationScale", parser: r }, { code: 10, name: "alignmentPoint", parser: i }, { code: 340, name: "secondaryAttributesHardId", parser: r }, { code: 70, name: "numberOfSecondaryAttributes", parser: r }, { code: 70, name: "isReallyLocked", parser: u }, { code: 70, name: "mtextFlag", parser: r }, { code: 280, name: "isDuplicatedEntriesKeep", parser: u }, { code: 100 }, { code: 280, name: "lockPositionFlag", parser: u }, { code: 210, name: "extrusionDirection", parser: i }, { code: 11, name: "alignmentPoint", parser: i }, { code: 74, name: "verticalJustification", parser: r }, { code: 72, name: "horizontalJustification", parser: r }, { code: 71, name: "textGenerationFlag", parser: r }, { code: 7, name: "textStyle", parser: r }, { code: 51, name: "obliqueAngle", parser: r }, { code: 41, name: "scale", parser: r }, { code: 50, name: "rotation", parser: r }, { code: 73 }, { code: 70, name: "attributeFlag", parser: r }, { code: 2, name: "tag", parser: r }, { code: 280 }, { code: 100, name: "subclassMarker", parser: r }, { code: 1, name: "text", parser: r }, { code: 40, name: "textHeight", parser: r }, { code: 10, name: "startPoint", parser: i }, { code: 39, name: "thickness", parser: r }, { code: 100 }, ...E];
class ta {
  parseEntity(n, a) {
    let t = {};
    return this.parser(a, n, t), t;
  }
  constructor() {
    na(this, "parser", p(Kn, zn));
  }
}
function oa(e, n, a) {
  return n in e ? Object.defineProperty(e, n, { value: a, enumerable: !0, configurable: !0, writable: !0 }) : e[n] = a, e;
}
na(ta, "ForEntityName", "ATTRIB");
let Zn = [...hr("data"), { code: 70, name: "version", parser: r }, { code: 100, name: "subclassMarker", parser: r }, ...E];
class sa {
  parseEntity(n, a) {
    let t = {};
    return this.parser(a, n, t), t;
  }
  constructor() {
    oa(this, "parser", p(Zn));
  }
}
function ia(e, n, a) {
  return n in e ? Object.defineProperty(e, n, { value: a, enumerable: !0, configurable: !0, writable: !0 }) : e[n] = a, e;
}
oa(sa, "ForEntityName", "BODY");
let $n = { thickness: 0, extrusionDirection: { x: 0, y: 0, z: 1 } }, Jn = [{ code: 210, name: "extrusionDirection", parser: i }, { code: 40, name: "radius", parser: r }, { code: 10, name: "center", parser: i }, { code: 39, name: "thickness", parser: r }, { code: 100, name: "subclassMarker", parser: r }, ...E];
class ca {
  parseEntity(n, a) {
    let t = {};
    return this.parser(a, n, t), t;
  }
  constructor() {
    ia(this, "parser", p(Jn, $n));
  }
}
function la(e, n, a) {
  return n in e ? Object.defineProperty(e, n, { value: a, enumerable: !0, configurable: !0, writable: !0 }) : e[n] = a, e;
}
ia(ca, "ForEntityName", "CIRCLE");
let qn = { extrusionDirection: { x: 0, y: 0, z: 1 } }, Qn = [{ code: 42, name: "endAngle", parser: r }, { code: 41, name: "startAngle", parser: r }, { code: 40, name: "axisRatio", parser: r }, { code: 210, name: "extrusionDirection", parser: i }, { code: 11, name: "majorAxisEndPoint", parser: i }, { code: 10, name: "center", parser: i }, { code: 100, name: "subclassMarker", parser: r }, ...E];
class da {
  parseEntity(n, a) {
    let t = {};
    return this.parser(a, n, t), t;
  }
  constructor() {
    la(this, "parser", p(Qn, qn));
  }
}
function ua(e, n, a) {
  return n in e ? Object.defineProperty(e, n, { value: a, enumerable: !0, configurable: !0, writable: !0 }) : e[n] = a, e;
}
la(da, "ForEntityName", "ELLIPSE");
let et = [{ code: 70, name: "invisibleEdgeFlags", parser: r }, { code: 13, name: "vertices.3", parser: i }, { code: 12, name: "vertices.2", parser: i }, { code: 11, name: "vertices.1", parser: i }, { code: 10, name: "vertices.0", parser: i }, { code: 100, name: "subclassMarker", parser: r }, ...E];
class pa {
  parseEntity(n, a) {
    let t = {};
    return this.parser(a, n, t), t;
  }
  constructor() {
    ua(this, "parser", p(et));
  }
}
ua(pa, "ForEntityName", "3DFACE");
(oe = {})[oe.First = 1] = "First", oe[oe.Second = 2] = "Second", oe[oe.Third = 4] = "Third", oe[oe.Fourth = 8] = "Fourth";
function rr(e, n, a) {
  return n in e ? Object.defineProperty(e, n, { value: a, enumerable: !0, configurable: !0, writable: !0 }) : e[n] = a, e;
}
class rt {
  getReadIndex() {
    return this._pointer;
  }
  getLines() {
    return this._data;
  }
  next() {
    if (!this.hasNext()) return this._eof ? this.debug : this.debug, { code: 0, value: "EOF" };
    let n = this._data[this._pointer++], a = parseInt(n, 10);
    Number.isNaN(a) && Hr(n);
    let t = _r(a, this._data[this._pointer++], this.debug), s = { code: a, value: t };
    return h(s, 0, "EOF") && (this._eof = !0), this.lastReadGroup = s, s;
  }
  peek() {
    if (!this.hasNext()) throw this._eof ? Error("Cannot call 'next' after EOF group has been read") : Error("Unexpected end of input: EOF group not read before end of file. Ended on code " + this._data[this._pointer]);
    let n = this._data[this._pointer], a = parseInt(n, 10);
    Number.isNaN(a) && Hr(n);
    let t = { code: a, value: 0 };
    return t.value = _r(t.code, this._data[this._pointer + 1], this.debug), t;
  }
  rewind(n) {
    n = n || 1, this._pointer = this._pointer - 2 * n;
  }
  hasNext() {
    return !this._eof && !(this._pointer > this._data.length - 2);
  }
  isEOF() {
    return this._eof;
  }
  constructor(n, a = !1) {
    rr(this, "_data", void 0), rr(this, "debug", void 0), rr(this, "_pointer", void 0), rr(this, "_eof", void 0), rr(this, "lastReadGroup", void 0), this._data = n, this.debug = a, this.lastReadGroup = { code: 0, value: 0 }, this._pointer = 0, this._eof = !1;
  }
}
function _r(e, n, a = !1) {
  var t;
  let s = (t = n).endsWith("\r") ? t.slice(0, -1) : t;
  return e <= 9 ? s : e >= 10 && e <= 59 ? parseFloat(n.trim()) : e >= 60 && e <= 99 ? parseInt(n.trim()) : e >= 100 && e <= 109 ? s : e >= 110 && e <= 149 ? parseFloat(n.trim()) : e >= 160 && e <= 179 ? parseInt(n.trim()) : e >= 210 && e <= 239 ? parseFloat(n.trim()) : e >= 270 && e <= 289 ? parseInt(n.trim()) : e >= 290 && e <= 299 ? function(o) {
    let c = o.trim().toLowerCase();
    if (c === "" || c === "0" || c === "false" || c === "f" || c === "no") return !1;
    if (c === "1" || c === "true" || c === "t" || c === "yes") return !0;
    let f = Number.parseFloat(c);
    if (!Number.isNaN(f)) return f !== 0;
    throw TypeError("String '" + o + "' cannot be cast to Boolean type");
  }(n.trim()) : e >= 300 && e <= 369 ? s : e >= 370 && e <= 389 ? parseInt(n.trim()) : e >= 390 && e <= 399 ? s : e >= 400 && e <= 409 ? parseInt(n.trim()) : e >= 410 && e <= 419 ? s : e >= 420 && e <= 429 ? parseInt(n.trim()) : e >= 430 && e <= 439 ? s : e >= 440 && e <= 459 ? parseInt(n.trim()) : e >= 460 && e <= 469 ? parseFloat(n.trim()) : e >= 470 && e <= 481 || e === 999 || e >= 1e3 && e <= 1009 ? s : e >= 1010 && e <= 1059 ? parseFloat(n.trim()) : e >= 1060 && e <= 1071 ? parseInt(n.trim()) : s;
}
function Hr(e) {
  let n = e.length > 120 ? `${e.slice(0, 120)}…` : e;
  throw Error(`Invalid DXF group code line: "${n}". Expected a numeric group code (often caused by binary DXF, UTF-16-encoded DXF, or stray blank lines). Use ASCII/text DXF or remove blank lines between code/value pairs.`);
}
let ma = [{ code: 330, name: "sourceBoundaryObjects", parser: r, isMultiple: !0 }, { code: 97, name: "numberOfSourceBoundaryObjects", parser: r }], at = [{ code: 11, name: "end", parser: i }, { code: 10, name: "start", parser: i }], nt = [{ code: 73, name: "isCCW", parser: u }, { code: 51, name: "endAngle", parser: r }, { code: 50, name: "startAngle", parser: r }, { code: 40, name: "radius", parser: r }, { code: 10, name: "center", parser: i }], tt = [{ code: 73, name: "isCCW", parser: u }, { code: 51, name: "endAngle", parser: r }, { code: 50, name: "startAngle", parser: r }, { code: 40, name: "lengthOfMinorAxis", parser: r }, { code: 11, name: "end", parser: i }, { code: 10, name: "center", parser: i }], ot = [{ code: 13, name: "endTangent", parser: i }, { code: 12, name: "startTangent", parser: i }, { code: 11, name: "fitDatum", isMultiple: !0, parser: i }, { code: 97, name: "numberOfFitData", parser: r }, { code: 10, name: "controlPoints", isMultiple: !0, parser(e, n) {
  let a = { ...he(n), weight: 1 };
  return (e = n.next()).code === 42 ? a.weight = e.value : n.rewind(), a;
} }, { code: 40, name: "knots", isMultiple: !0, parser: r }, { code: 96, name: "numberOfControlPoints", parser: r }, { code: 95, name: "numberOfKnots", parser: r }, { code: 74, name: "isPeriodic", parser: u }, { code: 73, name: "splineFlag", parser: r }, { code: 94, name: "degree", parser: r }], st = { [nr.Line]: at, [nr.Circular]: nt, [nr.Elliptic]: tt, [nr.Spline]: ot }, it = [...ma, { code: 72, name: "edges", parser(e, n) {
  let a = { type: e.value }, t = st[a.type];
  if (t == null) throw Error(`Unsupported HATCH boundary edge type: ${a.type} (expected 1–4: line, arc, elliptic arc, spline). This often happens when a polyline hatch boundary is parsed as edge segments (e.g. group 92 boundary flag missing the polyline bit). Try re-saving as ASCII DXF or simplifying hatch boundaries in CAD.`);
  return p(t)(e = n.next(), n, a), a;
}, isMultiple: !0 }, { code: 93, name: "numberOfEdges", parser: r }], ct = [...ma, { code: 10, name: "vertices", parser(e, n) {
  let a = { ...he(n), bulge: 0 };
  return (e = n.next()).code === 42 ? a.bulge = e.value : n.rewind(), a;
}, isMultiple: !0 }, { code: 93, name: "numberOfVertices", parser: r }, { code: 73, name: "isClosed", parser: u }, { code: 72, name: "hasBulge", parser: u }];
function lt(e, n) {
  let a = { boundaryPathTypeFlag: e.value }, t = !!(a.boundaryPathTypeFlag & gn.Polyline), s = n.getReadIndex();
  return e = n.next(), !t && function(o, c) {
    let f = Math.min(o.length, c + 120), d = c;
    for (; d < f - 1; ) {
      let l = parseInt(o[d], 10);
      if (Number.isNaN(l)) break;
      if (l === 93) {
        if (d + 3 >= o.length || parseInt(o[d + 2], 10) !== 72) return !1;
        let m = _r(72, o[d + 3]);
        if (m === 0) return !0;
        if (m === 1) {
          if (d + 5 < o.length && parseInt(o[d + 4], 10) === 73) return !0;
          if (d + 8 < o.length && parseInt(o[d + 4], 10) === 10) {
            let b = parseInt(o[d + 8], 10);
            if (b === 10 || b === 42) return !0;
          }
        }
        break;
      }
      if (l === 0) break;
      d += 2;
    }
    return !1;
  }(n.getLines(), s) && (t = !0), t ? p(ct)(e, n, a) : p(it)(e, n, a), a;
}
let dt = [{ code: 49, name: "dashLengths", parser: r, isMultiple: !0 }, { code: 79, name: "numberOfDashLengths", parser: r }, { code: 45, name: "offset", parser: Gr }, { code: 43, name: "base", parser: Gr }, { code: 53, name: "angle", parser: r }];
function Gr(e, n) {
  let a = e.code + 1, t = { x: e.value, y: 1 };
  return (e = n.next()).code === a ? t.y = e.value : n.rewind(), t;
}
function ut(e, n) {
  let a = {};
  return p(dt)(e, n, a), a;
}
function pt(e, n) {
  let a = [];
  for (; e.code === 463; ) {
    let t = { reservedField: e.value };
    if ((e = n.next()).code === 63 && (t.colorIndex = e.value, e = n.next()), e.code === 421) t.rgb = e.value, a.push(t), e = n.next();
    else {
      n.rewind();
      break;
    }
  }
  return e.code !== 463 && a.length > 0 && n.rewind(), a;
}
function fa(e, n, a) {
  return n in e ? Object.defineProperty(e, n, { value: a, enumerable: !0, configurable: !0, writable: !0 }) : e[n] = a, e;
}
let mt = { extrusionDirection: { x: 0, y: 0, z: 1 }, gradientRotation: 0, colorTint: 0 }, ft = [{ code: 470, name: "gradientName", parser: r }, { code: 463, name: "gradientColors", parser: pt }, { code: 462, name: "colorTint", parser: r }, { code: 461, name: "gradientDefinition", parser: r }, { code: 460, name: "gradientRotation", parser: r }, { code: 453, name: "numberOfColors", parser: r }, { code: 452, name: "gradientColorFlag", parser: r }, { code: 451 }, { code: 450, name: "gradientFlag", parser: r }, { code: 10, name: "seedPoints", parser: i, isMultiple: !0 }, { code: 99 }, { code: 11, name: "offsetVector", parser: i }, { code: 98, name: "numberOfSeedPoints", parser: r }, { code: 47, name: "pixelSize", parser: r }, { code: 53, name: "definitionLines", parser: ut, isMultiple: !0 }, { code: 78, name: "numberOfDefinitionLines", parser: r }, { code: 77, name: "isDouble", parser: u }, { code: 73, name: "isAnnotated", parser: u }, { code: 41, name: "patternScale", parser: r }, { code: 52, name: "patternAngle", parser: r }, { code: 76, name: "patternType", parser: r }, { code: 75, name: "hatchStyle", parser: r }, { code: 92, name: "boundaryPaths", parser: lt, isMultiple: !0 }, { code: 91, name: "numberOfBoundaryPaths", parser: r }, { code: 71, name: "associativity", parser: r }, { code: 63, name: "patternFillColor", parser: r }, { code: 70, name: "solidFill", parser: r }, { code: 2, name: "patternName", parser: r }, { code: 210, name: "extrusionDirection", parser: i }, { code: 10, name: "elevationPoint", parser: i }, { code: 100, name: "subclassMarker", parser: r, pushContext: !0 }, ...E];
class ba {
  parseEntity(n, a) {
    let t = {};
    return this.parser(a, n, t), t;
  }
  constructor() {
    fa(this, "parser", p(ft, mt));
  }
}
function Ia(e, n, a) {
  return n in e ? Object.defineProperty(e, n, { value: a, enumerable: !0, configurable: !0, writable: !0 }) : e[n] = a, e;
}
fa(ba, "ForEntityName", "HATCH");
let bt = { brightness: 50, contrast: 50, fade: 0, clippingBoundaryPath: [] }, It = [{ code: 290, name: "clipMode", parser: r }, { code: 14, name: "clippingBoundaryPath", isMultiple: !0, parser: i }, { code: 91, name: "countBoundaryPoints", parser: r }, { code: 71, name: "clippingBoundaryType", parser: r }, { code: 360, name: "imageDefReactorHandle", parser: r }, { code: 283, name: "fade", parser: r }, { code: 282, name: "contrast", parser: r }, { code: 281, name: "brightness", parser: r }, { code: 280, name: "isClipped", parser: u }, { code: 70, name: "flags", parser: r }, { code: 340, name: "imageDefHandle", parser: r }, { code: 13, name: "imageSize", parser: i }, { code: 12, name: "vPixel", parser: i }, { code: 11, name: "uPixel", parser: i }, { code: 10, name: "position", parser: i }, { code: 90, name: "version", parser: r }, { code: 100, name: "subclassMarker", parser: r }, ...E];
class ha {
  parseEntity(n, a) {
    let t = {};
    return this.parser(a, n, t), t;
  }
  constructor() {
    Ia(this, "parser", p(It, bt));
  }
}
Ia(ha, "ForEntityName", "IMAGE");
(se = {})[se.ShowImage = 1] = "ShowImage", se[se.ShowImageWhenNotAlignedWithScreen = 2] = "ShowImageWhenNotAlignedWithScreen", se[se.UseClippingBoundary = 4] = "UseClippingBoundary", se[se.TransparencyIsOn = 8] = "TransparencyIsOn";
(Je = {})[Je.Rectangular = 1] = "Rectangular", Je[Je.Polygonal = 2] = "Polygonal";
(qe = {})[qe.Outside = 0] = "Outside", qe[qe.Inside = 1] = "Inside";
function Ea(e, n, a) {
  return n in e ? Object.defineProperty(e, n, { value: a, enumerable: !0, configurable: !0, writable: !0 }) : e[n] = a, e;
}
let ht = { xScale: 1, yScale: 1, zScale: 1, rotation: 0, columnCount: 0, rowCount: 0, columnSpacing: 0, rowSpacing: 0, extrusionDirection: { x: 0, y: 0, z: 1 } }, Et = [{ code: 210, name: "extrusionDirection", parser: i }, { code: 45, name: "rowSpacing", parser: r }, { code: 44, name: "columnSpacing", parser: r }, { code: 71, name: "rowCount", parser: r }, { code: 70, name: "columnCount", parser: r }, { code: 50, name: "rotation", parser: r }, { code: 43, name: "zScale", parser: r }, { code: 42, name: "yScale", parser: r }, { code: 41, name: "xScale", parser: r }, { code: 10, name: "insertionPoint", parser: i }, { code: 2, name: "name", parser: r }, { code: 66, name: "isVariableAttributes", parser: u }, { code: 100, name: "subclassMarker", parser: r }, ...E];
class ga {
  parseEntity(n, a) {
    let t = {};
    return this.parser(a, n, t), t;
  }
  constructor() {
    Ea(this, "parser", p(Et, ht));
  }
}
function xa(e, n, a) {
  return n in e ? Object.defineProperty(e, n, { value: a, enumerable: !0, configurable: !0, writable: !0 }) : e[n] = a, e;
}
Ea(ga, "ForEntityName", "INSERT");
let gt = { isArrowheadEnabled: !0 }, xt = [{ code: 213, name: "offsetFromAnnotation", parser: i }, { code: 212, name: "offsetFromBlock", parser: i }, { code: 211, name: "horizontalDirection", parser: i }, { code: 210, name: "normal", parser: i }, { code: 340, name: "associatedAnnotation", parser: r }, { code: 77, name: "byBlockColor", parser: r }, { code: 10, name: "vertices", parser: i, isMultiple: !0 }, { code: 76, name: "numberOfVertices", parser: r }, { code: 41, name: "textWidth", parser: r }, { code: 40, name: "textHeight", parser: r }, { code: 75, name: "isHooklineExists", parser: u }, { code: 74, name: "isHooklineSameDirection", parser: u }, { code: 73, name: "leaderCreationFlag", parser: r }, { code: 72, name: "isSpline", parser: u }, { code: 71, name: "isArrowheadEnabled", parser: u }, { code: 3, name: "styleName", parser: r }, { code: 100, name: "subclassMarker", parser: r }, ...E];
class ya {
  parseEntity(n, a) {
    let t = {};
    return this.parser(a, n, t), t;
  }
  constructor() {
    xa(this, "parser", p(xt, gt));
  }
}
xa(ya, "ForEntityName", "LEADER");
(ie = {})[ie.TextAnnotation = 0] = "TextAnnotation", ie[ie.ToleranceAnnotation = 1] = "ToleranceAnnotation", ie[ie.BlockReferenceAnnotation = 2] = "BlockReferenceAnnotation", ie[ie.NoAnnotation = 3] = "NoAnnotation";
function va(e, n, a) {
  return n in e ? Object.defineProperty(e, n, { value: a, enumerable: !0, configurable: !0, writable: !0 }) : e[n] = a, e;
}
let yt = { thickness: 0, extrusionDirection: { x: 0, y: 0, z: 1 } }, vt = [{ code: 210, name: "extrusionDirection", parser: i }, { code: 11, name: "endPoint", parser: i }, { code: 10, name: "startPoint", parser: i }, { code: 39, name: "thickness", parser: r }, { code: 100, name: "subclassMarker", parser: r }, ...E];
class Sa {
  parseEntity(n, a) {
    let t = {};
    return this.parser(a, n, t), t;
  }
  constructor() {
    va(this, "parser", p(vt, yt));
  }
}
function Ta(e, n, a) {
  return n in e ? Object.defineProperty(e, n, { value: a, enumerable: !0, configurable: !0, writable: !0 }) : e[n] = a, e;
}
va(Sa, "ForEntityName", "LINE");
let St = [{ code: 280, name: "shadowMapSoftness", parser: r }, { code: 91, name: "shadowMapSize", parser: r }, { code: 73, name: "shadowType", parser: r }, { code: 293, name: "isShadowCast", parser: u }, { code: 51, name: "falloffAngle", parser: r }, { code: 50, name: "hotspotAngle", parser: r }, { code: 42, name: "limitEnd", parser: r }, { code: 41, name: "limitStart", parser: r }, { code: 292, name: "isAttenuationLimited", parser: u }, { code: 72, name: "attenuationType", parser: r }, { code: 11, name: "target", parser: i }, { code: 10, name: "position", parser: i }, { code: 40, name: "intensity", parser: r }, { code: 291, name: "isPlotGlyph", parser: u }, { code: 290, name: "isOn", parser: u }, { code: 421, name: "lightColorInstance", parser: r }, { code: 63, name: "lightColorIndex", parser: r }, { code: 70, name: "lightType", parser: r }, { code: 1, name: "name", parser: r }, { code: 90, name: "version", parser: r }, { code: 100, name: "subclassMarker", parser: r }, ...E];
class Oa {
  parseEntity(n, a) {
    let t = {};
    return this.parser(a, n, t), t;
  }
  constructor() {
    Ta(this, "parser", p(St));
  }
}
Ta(Oa, "ForEntityName", "LIGHT");
(Ae = {})[Ae.Distant = 1] = "Distant", Ae[Ae.Point = 2] = "Point", Ae[Ae.Spot = 3] = "Spot";
(De = {})[De.None = 0] = "None", De[De.InverseLinear = 1] = "InverseLinear", De[De.InverseSquare = 2] = "InverseSquare";
let Tt = { flag: 0, elevation: 0, thickness: 0, extrusionDirection: { x: 0, y: 0, z: 1 }, vertices: [] }, Ot = { bulge: 0 }, Nt = [{ code: 42, name: "bulge", parser: r }, { code: 41, name: "endWidth", parser: r }, { code: 40, name: "startWidth", parser: r }, { code: 91, name: "id", parser: r }, { code: 20, name: "y", parser: r }, { code: 10, name: "x", parser: r }], At = [{ code: 210, name: "extrusionDirection", parser: i }, { code: 10, name: "vertices", isMultiple: !0, parser(e, n) {
  let a = {};
  return p(Nt, Ot)(e, n, a), a;
} }, { code: 39, name: "thickness", parser: r }, { code: 38, name: "elevation", parser: r }, { code: 43, name: "constantWidth", parser: r }, { code: 70, name: "flag", parser: r }, { code: 90, name: "numberOfVertices", parser: r }, { code: 100, name: "subclassMarker", parser: r }, ...E];
class pr {
  parseEntity(n, a) {
    let t = {};
    return p(At, Tt)(a, n, t), t;
  }
}
(Nr = "ForEntityName") in pr ? Object.defineProperty(pr, Nr, { value: "LWPOLYLINE", enumerable: !0, configurable: !0, writable: !0 }) : pr[Nr] = "LWPOLYLINE";
(Qe = {})[Qe.IS_CLOSED = 1] = "IS_CLOSED", Qe[Qe.PLINE_GEN = 128] = "PLINE_GEN";
function Na(e, n, a) {
  return n in e ? Object.defineProperty(e, n, { value: a, enumerable: !0, configurable: !0, writable: !0 }) : e[n] = a, e;
}
let Dt = [{ code: 90, name: "overridenSubEntityCount", parser: r }, { code: 140, name: "edgeCreaseWeights", parser: r, isMultiple: !0 }, { code: 95, name: "edgeCreaseCount", parser: r }, { code: 94, parser(e, n, a) {
  a.edgeCount = e.value, a.edgeIndices = [];
  for (let t = 0; t < a.edgeCount; ++t) {
    let s = [];
    e = n.next(), s[0] = e.value, e = n.next(), s[1] = e.value, a.edgeIndices.push(s);
  }
} }, { code: 93, parser(e, n, a) {
  a.totalFaceIndices = e.value, a.faceIndices = [];
  let t = [];
  for (let o = 0; o < a.totalFaceIndices && !h(e, 0); ++o) e = n.next(), t.push(e.value);
  let s = 0;
  for (; s < t.length; ) {
    let o = t[s++], c = [];
    for (let f = 0; f < o; ++f) c.push(t[s++]);
    a.faceIndices.push(c);
  }
} }, { code: 10, name: "vertices", parser: i, isMultiple: !0 }, { code: 92, name: "verticesCount", parser: r }, { code: 91, name: "subdivisionLevel", parser: r }, { code: 40, name: "blendCrease", parser: r }, { code: 72, name: "isBlendCreased", parser: u }, { code: 71, name: "version", parser: r }, { code: 100, name: "subclassMarker", parser: vn, pushContext: !0 }, ...E];
class Aa {
  parseEntity(n, a) {
    let t = {};
    return this.parser(a, n, t), t;
  }
  constructor() {
    Na(this, "parser", p(Dt));
  }
}
function Da(e, n, a) {
  return n in e ? Object.defineProperty(e, n, { value: a, enumerable: !0, configurable: !0, writable: !0 }) : e[n] = a, e;
}
Na(Aa, "ForEntityName", "MESH");
let kt = [{ code: 42, name: "fillParameters", parser: r, isMultiple: !0 }, { code: 75, name: "fillCount", parser: r }, { code: 41, name: "parameters", parser: r, isMultiple: !0 }, { code: 74, name: "parameterCount", parser: r }], Lt = [{ code: [74, 41, 75, 42], name: "elements", parser(e, n) {
  let a = p(kt), t = {};
  return a(e, n, t), t;
}, isMultiple: !0 }, { code: 13, name: "miterDirection", parser: i }, { code: 12, name: "direction", parser: i }, { code: 11, name: "position", parser: i }], Ct = [{ code: [11, 12, 13], name: "segments", parser(e, n) {
  let a = p(Lt), t = {};
  return a(e, n, t), t;
}, isMultiple: !0 }, { code: 210, name: "extrusionDirection", parser: i }, { code: 10, name: "startPosition", parser: i }, { code: 73, name: "styleCount", parser: r }, { code: 72, name: "vertexCount", parser: r }, { code: 71, name: "flags", parser: r }, { code: 70, name: "justification", parser: r }, { code: 40, name: "scale", parser: r }, { code: 340, name: "styleObjectHandle", parser: r }, { code: 2, name: "name", parser: r }, { code: 100, name: "subclassMarker", parser: r, pushContext: !0 }, ...E];
class ka {
  parseEntity(n, a) {
    let t = {};
    return this.parser(a, n, t), t;
  }
  constructor() {
    Da(this, "parser", p(Ct));
  }
}
Da(ka, "ForEntityName", "MLINE");
(ke = {})[ke.Top = 0] = "Top", ke[ke.Zero = 1] = "Zero", ke[ke.Bottom = 2] = "Bottom";
(ce = {})[ce.HasVertex = 1] = "HasVertex", ce[ce.Closed = 2] = "Closed", ce[ce.SuppressStartCaps = 4] = "SuppressStartCaps", ce[ce.SuppressEndCaps = 8] = "SuppressEndCaps";
(Le = {})[Le.LEFT_TO_RIGHT = 1] = "LEFT_TO_RIGHT", Le[Le.TOP_TO_BOTTOM = 3] = "TOP_TO_BOTTOM", Le[Le.BY_STYLE = 5] = "BY_STYLE";
function La(e, n, a) {
  return n in e ? Object.defineProperty(e, n, { value: a, enumerable: !0, configurable: !0, writable: !0 }) : e[n] = a, e;
}
let Mt = {}, wt = [{ code: 300, parser: function(e, n, a) {
  var o;
  let t;
  if (e.value === "CONTEXT_DATA{") for (; n.hasNext(); ) {
    var s;
    if ((t = n.next()).code === 301) break;
    switch (t.code) {
      case 10:
        a.contentBasePosition = C(t, n);
        break;
      case 11:
        a.normal = C(t, n);
        break;
      case 12:
        a.textAnchor = C(t, n);
        break;
      case 13:
        a.textDirection = C(t, n);
        break;
      case 14:
        me(a).normal = C(t, n);
        break;
      case 15:
        me(a).position = C(t, n);
        break;
      case 16:
        me(a).scale = C(t, n);
        break;
      case 40:
        a.contentScale = t.value;
        break;
      case 41:
      case 44:
        a.textHeight = t.value;
        break;
      case 42:
        a.textRotation = t.value;
        break;
      case 43:
        a.textWidth = t.value;
        break;
      case 45:
        a.textLineSpacingFactor = t.value;
        break;
      case 46:
        me(a).rotation = t.value;
        break;
      case 47:
        (s = me(a)).transformationMatrix ?? (s.transformationMatrix = []), (o = me(a).transformationMatrix) == null || o.push(t.value);
        break;
      case 90:
        a.textColor = t.value;
        break;
      case 91:
        a.textBackgroundColor = t.value;
        break;
      case 92:
        a.textBackgroundTransparency = t.value;
        break;
      case 93:
        me(a).color = t.value;
        break;
      case 110:
        a.planeOrigin = C(t, n);
        break;
      case 111:
        a.planeXAxisDirection = C(t, n);
        break;
      case 112:
        a.planeYAxisDirection = C(t, n);
        break;
      case 140:
        a.arrowheadSize = t.value;
        break;
      case 141:
        a.textBackgroundScaleFactor = t.value;
        break;
      case 142:
        a.textColumnWidth = t.value;
        break;
      case 143:
        a.textColumnGutterWidth = t.value;
        break;
      case 144:
        a.textColumnHeight = t.value;
        break;
      case 145:
        a.landingGap = t.value;
        break;
      case 170:
        a.textLineSpacingStyle = t.value;
        break;
      case 171:
        a.textAttachment = t.value;
        break;
      case 172:
        a.textFlowDirection = t.value;
        break;
      case 173:
        a.textColumnType = t.value;
        break;
      case 290:
        a.hasMText = t.value;
        break;
      case 291:
        a.textBackgroundColorOn = t.value;
        break;
      case 292:
        a.textFillOn = t.value;
        break;
      case 293:
        a.textUseAutoHeight = t.value;
        break;
      case 294:
        a.textColumnFlowReversed = t.value;
        break;
      case 295:
        a.textUseWordBreak = t.value;
        break;
      case 296:
        a.hasBlock = t.value;
        break;
      case 297:
        a.planeNormalReversed = t.value;
        break;
      case 302:
        t.value === "LEADER{" && (a.leaderSections ?? (a.leaderSections = []), a.leaderSections.push(function(c, f) {
          let d, l;
          if (c.value !== "LEADER{") return { leaderLines: [] };
          let m = { leaderLines: [] };
          for (; f.hasNext(); ) {
            if ((l = f.next()).code === 303) {
              tr(m, d);
              break;
            }
            switch (l.code) {
              case 290:
                m.lastLeaderLinePointSet = l.value;
                break;
              case 291:
                m.doglegVectorSet = l.value;
                break;
              case 10:
                m.lastLeaderLinePoint = C(l, f);
                break;
              case 11:
                m.doglegVector = C(l, f);
                break;
              case 12:
                d ?? (d = {}), d.start = C(l, f);
                break;
              case 13:
                d ?? (d = {}), d.end = C(l, f), tr(m, d), d = void 0;
                break;
              case 90:
                m.leaderBranchIndex = l.value;
                break;
              case 40:
                m.doglegLength = l.value;
                break;
              case 304:
                l.value === "LEADER_LINE{" && m.leaderLines.push(function(b, y) {
                  let g, S;
                  if (b.value !== "LEADER_LINE{") return { vertices: [] };
                  let v = { vertices: [] };
                  for (; y.hasNext(); ) {
                    if ((S = y.next()).code === 305) {
                      tr(v, g);
                      break;
                    }
                    switch (S.code) {
                      case 10:
                        v.vertices.push(C(S, y));
                        break;
                      case 11:
                        g ?? (g = {}), g.start = C(S, y);
                        break;
                      case 12:
                        g ?? (g = {}), g.end = C(S, y), tr(v, g), g = void 0;
                        break;
                      case 90:
                        v.breakPointIndexes ?? (v.breakPointIndexes = []), v.breakPointIndexes.push(S.value), g ?? (g = {}), g.index = S.value;
                        break;
                      case 91:
                        v.leaderLineIndex = S.value;
                    }
                  }
                  return v;
                }(l, f));
            }
          }
          return m;
        }(t, n)));
        break;
      case 304:
        t.value !== "LEADER_LINE{" && (a.textContent = t.value, a.contentType ?? (a.contentType = 2));
        break;
      case 340:
        a.textStyleId = t.value;
        break;
      case 341:
        a.blockContentId = t.value, me(a).blockContentId = t.value;
    }
  }
} }, { code: 270, name: "version", parser: r }, { code: 340, name: "leaderStyleId", parser: r }, { code: 90, name: "propertyOverrideFlag", parser: r }, { code: 170, name: "leaderLineType", parser: r }, { code: 91, name: "leaderLineColor", parser: r }, { code: 341, name: "leaderLineTypeId", parser: r }, { code: 171, name: "leaderLineWeight", parser: r }, { code: 290, name: "landingEnabled", parser: u }, { code: 291, name: "doglegEnabled", parser: u }, { code: [40, 41], name: "doglegLength", parser: r }, { code: 342, name: "arrowheadId", parser: r }, { code: 42, name: "arrowheadSize", parser: r }, { code: 172, name: "contentType", parser: r }, { code: 343, name: "textStyleId", parser: r }, { code: 173, name: "textLeftAttachmentType", parser: r }, { code: 95, name: "textRightAttachmentType", parser: r }, { code: 174, name: "textAngleType", parser: r }, { code: 175, name: "textAlignmentType", parser: r }, { code: 92, name: "textColor", parser: r }, { code: 292, name: "textFrameEnabled", parser: u }, { code: 344, parser: function(e, n, a) {
  a.blockContentId = e.value, me(a).blockContentId = e.value;
} }, { code: 93, name: "blockContentColor", parser: r }, { code: 10, name: "blockContentScale", parser: i }, { code: 43, name: "blockContentRotation", parser: r }, { code: 176, name: "blockContentConnectionType", parser: r }, { code: 293, name: "annotativeScaleEnabled", parser: u }, { code: 94, parser: function(e, n, a) {
  a.arrowheadOverrides ?? (a.arrowheadOverrides = []), a.arrowheadOverrides.push({ index: e.value });
}, isMultiple: !0 }, { code: 345, parser: function(e, n, a) {
  var t;
  ((t = a).arrowheadOverrides ?? (t.arrowheadOverrides = []), t.arrowheadOverrides.length || t.arrowheadOverrides.push({}), t.arrowheadOverrides[t.arrowheadOverrides.length - 1]).handle = e.value;
}, isMultiple: !0 }, { code: 330, parser: function(e, n, a) {
  a.blockAttributes ?? (a.blockAttributes = []), a.blockAttributes.push({ id: e.value });
}, isMultiple: !0 }, { code: 177, parser: function(e, n, a) {
  Cr(a).index = e.value;
}, isMultiple: !0 }, { code: 44, parser: function(e, n, a) {
  Cr(a).width = e.value;
}, isMultiple: !0 }, { code: 302, parser: function(e, n, a) {
  Cr(a).text = e.value;
}, isMultiple: !0 }, { code: 294, name: "textDirectionNegative", parser: u }, { code: 178, name: "textAlignInIPE", parser: r }, { code: 179, name: "textAttachmentPoint", parser: r }, { code: 271, name: "textAttachmentDirection", parser: r }, { code: 272, name: "bottomTextAttachmentDirection", parser: r }, { code: 273, name: "topTextAttachmentDirection", parser: r }, { code: 100, name: "subclassMarker", parser: r }, ...E];
function C(e, n) {
  return wr(i(e, n));
}
function tr(e, n) {
  (n != null && n.start || n != null && n.end) && (e.breaks ?? (e.breaks = []), e.breaks.push(n));
}
function me(e) {
  return e.blockContent ?? (e.blockContent = {});
}
function Cr(e) {
  return e.blockAttributes ?? (e.blockAttributes = []), e.blockAttributes.length || e.blockAttributes.push({}), e.blockAttributes[e.blockAttributes.length - 1];
}
class Ca {
  parseEntity(n, a) {
    let t = {};
    return this.parser(a, n, t), t;
  }
  constructor() {
    La(this, "parser", p(wt, Mt));
  }
}
function Ma(e, n, a) {
  return n in e ? Object.defineProperty(e, n, { value: a, enumerable: !0, configurable: !0, writable: !0 }) : e[n] = a, e;
}
La(Ca, "ForEntityName", "MULTILEADER");
let _t = { thickness: 0, extrusionDirection: { x: 0, y: 0, z: 1 }, angle: 0 }, Ft = [{ code: 50, name: "angle", parser: r }, { code: 210, name: "extrusionDirection", parser: i }, { code: 39, name: "thickness", parser: r }, { code: 10, name: "position", parser: i }, { code: 100, name: "subclassMarker", parser: r }, ...E];
class wa {
  parseEntity(n, a) {
    let t = {};
    return this.parser(a, n, t), t;
  }
  constructor() {
    Ma(this, "parser", p(Ft, _t));
  }
}
function _a(e, n, a) {
  return n in e ? Object.defineProperty(e, n, { value: a, enumerable: !0, configurable: !0, writable: !0 }) : e[n] = a, e;
}
Ma(wa, "ForEntityName", "POINT");
let Rt = { startWidth: 0, endWidth: 0, bulge: 0 }, Pt = [{ code: 91, name: "id", parser: r }, { code: [...Ir(71, 75)], name: "faces", isMultiple: !0, parser: r }, { code: 50, name: "tangentDirection", parser: r }, { code: 70, name: "flag", parser: r }, { code: 42, name: "bulge", parser: r }, { code: 41, name: "endWidth", parser: r }, { code: 40, name: "startWidth", parser: r }, { code: 30, name: "z", parser: r }, { code: 20, name: "y", parser: r }, { code: 10, name: "x", parser: r }, { code: 100, name: "subclassMarker", parser: r }, { code: 100 }, ...E];
class Pr {
  parseEntity(n, a) {
    let t = {};
    return this.parser(a, n, t), t;
  }
  constructor() {
    _a(this, "parser", p(Pt, Rt));
  }
}
function Fa(e, n, a) {
  return n in e ? Object.defineProperty(e, n, { value: a, enumerable: !0, configurable: !0, writable: !0 }) : e[n] = a, e;
}
_a(Pr, "ForEntityName", "VERTEX");
let Bt = { thickness: 0, flag: 0, startWidth: 0, endWidth: 0, meshMVertexCount: 0, meshNVertexCount: 0, surfaceMDensity: 0, surfaceNDensity: 0, smoothType: 0, extrusionDirection: { x: 0, y: 0, z: 1 }, vertices: [] }, Vt = [{ code: 0, name: "vertices", isMultiple: !0, parser: (e, n) => h(e, 0, "VERTEX") ? (e = n.next(), new Pr().parseEntity(n, e)) : ar }, { code: 210, name: "extrusionDirection", parser: i }, { code: 75, name: "smoothType", parser: r }, { code: 74, name: "surfaceNDensity", parser: r }, { code: 73, name: "surfaceMDensity", parser: r }, { code: 72, name: "meshNVertexCount", parser: r }, { code: 71, name: "meshMVertexCount", parser: r }, { code: 41, name: "endWidth", parser: r }, { code: 40, name: "startWidth", parser: r }, { code: 70, name: "flag", parser: r }, { code: 39, name: "thickness", parser: r }, { code: 30, name: "elevation", parser: r }, { code: 20 }, { code: 10 }, { code: 66 }, { code: 100, name: "subclassMarker", parser: r }, ...E];
class Ra {
  parseEntity(n, a) {
    let t = {};
    return this.parser(a, n, t), t;
  }
  constructor() {
    Fa(this, "parser", p(Vt, Bt));
  }
}
Fa(Ra, "ForEntityName", "POLYLINE");
(k = {})[k.CLOSED_POLYLINE = 1] = "CLOSED_POLYLINE", k[k.CURVE_FIT = 2] = "CURVE_FIT", k[k.SPLINE_FIT = 4] = "SPLINE_FIT", k[k.POLYLINE_3D = 8] = "POLYLINE_3D", k[k.POLYGON_3D = 16] = "POLYGON_3D", k[k.CLOSED_POLYGON = 32] = "CLOSED_POLYGON", k[k.POLYFACE = 64] = "POLYFACE", k[k.CONTINUOUS = 128] = "CONTINUOUS";
(le = {})[le.NONE = 0] = "NONE", le[le.QUADRATIC = 5] = "QUADRATIC", le[le.CUBIC = 6] = "CUBIC", le[le.BEZIER = 8] = "BEZIER";
function Pa(e, n, a) {
  return n in e ? Object.defineProperty(e, n, { value: a, enumerable: !0, configurable: !0, writable: !0 }) : e[n] = a, e;
}
let Ut = [{ code: 11, name: "direction", parser: i }, { code: 10, name: "position", parser: i }, { code: 100, name: "subclassMarker", parser: r }, ...E];
class Ba {
  parseEntity(n, a) {
    let t = {};
    return this.parser(a, n, t), t;
  }
  constructor() {
    Pa(this, "parser", p(Ut));
  }
}
function Va(e, n, a) {
  return n in e ? Object.defineProperty(e, n, { value: a, enumerable: !0, configurable: !0, writable: !0 }) : e[n] = a, e;
}
Pa(Ba, "ForEntityName", "RAY");
let Ht = [...hr("data"), { code: 70, name: "version", parser: r }, { code: 100, name: "subclassMarker", parser: r }, ...E];
class Ua {
  parseEntity(n, a) {
    let t = {};
    return this.parser(a, n, t), t;
  }
  constructor() {
    Va(this, "parser", p(Ht));
  }
}
function Ha(e, n, a) {
  return n in e ? Object.defineProperty(e, n, { value: a, enumerable: !0, configurable: !0, writable: !0 }) : e[n] = a, e;
}
Va(Ua, "ForEntityName", "REGION");
let Gt = { vertices: [], backLineVertices: [] }, Wt = [{ code: 360, name: "geometrySettingHardId", parser: r }, { code: 12, name: "backLineVertices", isMultiple: !0, parser: i }, { code: 93, name: "numberOfBackLineVertices", parser: r }, { code: 11, name: "vertices", isMultiple: !0, parser: i }, { code: 92, name: "verticesCount", parser: r }, { code: [63, 411], name: "indicatorColor", parser: r }, { code: 70, name: "indicatorTransparency", parser: r }, { code: 41, name: "bottomHeight", parser: r }, { code: 40, name: "topHeight", parser: r }, { code: 10, name: "verticalDirection", parser: i }, { code: 1, name: "name", parser: r }, { code: 91, name: "flag", parser: r }, { code: 90, name: "state", parser: r }, { code: 100, name: "subclassMarker", parser: r }, ...E];
class Ga {
  parseEntity(n, a) {
    let t = {};
    return this.parser(a, n, t), t;
  }
  constructor() {
    Ha(this, "parser", p(Wt, Gt));
  }
}
function Wa(e, n, a) {
  return n in e ? Object.defineProperty(e, n, { value: a, enumerable: !0, configurable: !0, writable: !0 }) : e[n] = a, e;
}
Ha(Ga, "ForEntityName", "SECTION");
let jt = { thickness: 0, rotation: 0, xScale: 1, obliqueAngle: 0, extrusionDirection: { x: 0, y: 0, z: 1 } }, Yt = [{ code: 210, name: "extrusionDirection", parser: i }, { code: 51, name: "obliqueAngle", parser: r }, { code: 41, name: "xScale", parser: r }, { code: 50, name: "rotation", parser: r }, { code: 2, name: "shapeName", parser: r }, { code: 40, name: "size", parser: r }, { code: 10, name: "insertionPoint", parser: i }, { code: 39, name: "thickness", parser: r }, { code: 100, name: "subclassMarker", parser: r }, ...E];
class ja {
  parseEntity(n, a) {
    let t = {};
    return this.parser(a, n, t), t;
  }
  constructor() {
    Wa(this, "parser", p(Yt, jt));
  }
}
function Ya(e, n, a) {
  return n in e ? Object.defineProperty(e, n, { value: a, enumerable: !0, configurable: !0, writable: !0 }) : e[n] = a, e;
}
Wa(ja, "ForEntityName", "SHAPE");
let Xt = { points: [], thickness: 0, extrusionDirection: { x: 0, y: 0, z: 1 } }, zt = [{ code: 210, name: "extrusionDirection", parser: i }, { code: 39, name: "thickness", parser: r }, { code: [...Ir(10, 14)], name: "points", isMultiple: !0, parser: i }, { code: 100, name: "subclassMarker", parser: r }, ...E];
class Xa {
  parseEntity(n, a) {
    let t = {};
    return this.parser(a, n, t), t;
  }
  constructor() {
    Ya(this, "parser", p(zt, Xt));
  }
}
function za(e, n, a) {
  return n in e ? Object.defineProperty(e, n, { value: a, enumerable: !0, configurable: !0, writable: !0 }) : e[n] = a, e;
}
Ya(Xa, "ForEntityName", "SOLID");
let Kt = [{ code: 350, name: "historyObjectSoftId", parser: r }, { code: 100, name: "subclassMarker", parser: r }, { code: 2, name: "guid", parser: r }, { code: 290, name: "satCache", parser: r }, ...hr("data"), { code: 70, name: "version", parser: r }, { code: 100 }, ...E];
class Ka {
  parseEntity(n, a) {
    let t = {};
    return this.parser(a, n, t), t;
  }
  constructor() {
    za(this, "parser", p(Kt));
  }
}
function Za(e, n, a) {
  return n in e ? Object.defineProperty(e, n, { value: a, enumerable: !0, configurable: !0, writable: !0 }) : e[n] = a, e;
}
za(Ka, "ForEntityName", "3DSOLID");
let Zt = { knotTolerance: 1e-6, controlTolerance: 1e-6, fitTolerance: 1e-9, knotValues: [], controlPoints: [], fitPoints: [] }, $t = [{ code: 11, name: "fitPoints", isMultiple: !0, parser: i }, { code: 10, name: "controlPoints", isMultiple: !0, parser: i }, { code: 41, name: "weights", isMultiple: !0, parser: r }, { code: 40, name: "knots", isMultiple: !0, parser: r }, { code: 13, name: "endTangent", parser: i }, { code: 12, name: "startTangent", parser: i }, { code: 44, name: "fitTolerance", parser: r }, { code: 43, name: "controlTolerance", parser: r }, { code: 42, name: "knotTolerance", parser: r }, { code: 74, name: "numberOfFitPoints", parser: r }, { code: 73, name: "numberOfControlPoints", parser: r }, { code: 72, name: "numberOfKnots", parser: r }, { code: 71, name: "degree", parser: r }, { code: 70, name: "flag", parser: r }, { code: 210, name: "normal", parser: i }, { code: 100, name: "subclassMarker", parser: r }, ...E];
class $a {
  parseEntity(n, a) {
    let t = {};
    return this.parser(a, n, t), t;
  }
  constructor() {
    Za(this, "parser", p($t, Zt));
  }
}
Za($a, "ForEntityName", "SPLINE");
(W = {})[W.NONE = 0] = "NONE", W[W.CLOSED = 1] = "CLOSED", W[W.PERIODIC = 2] = "PERIODIC", W[W.RATIONAL = 4] = "RATIONAL", W[W.PLANAR = 8] = "PLANAR", W[W.LINEAR = 16] = "LINEAR";
function Ja(e, n, a) {
  return n in e ? Object.defineProperty(e, n, { value: a, enumerable: !0, configurable: !0, writable: !0 }) : e[n] = a, e;
}
let Jt = [{ code: 280, name: "shadowMapSoftness", parser: r }, { code: 71, name: "shadowMapSize", parser: r }, { code: 70, name: "shadowType", parser: r }, { code: 292, name: "isSummerTime", parser: u }, { code: 92, name: "time", parser: r }, { code: 91, name: "julianDay", parser: r }, { code: 291, name: "hasShadow", parser: u }, { code: 40, name: "intensity", parser: r }, { code: 421, name: "lightColorInstance", parser: r }, { code: 63, name: "lightColorIndex", parser: r }, { code: 290, name: "isOn", parser: u }, { code: 90, name: "version", parser: r }, { code: 100, name: "subclassMarker", parser: r, pushContext: !0 }, ...E.filter((e) => e.code !== 100)];
class qa {
  parseEntity(n, a) {
    let t = { layer: "" };
    return this.parser(a, n, t), t;
  }
  constructor() {
    Ja(this, "parser", p(Jt));
  }
}
Ja(qa, "ForEntityName", "SUN");
class mr {
  parseEntity(n, a) {
    let t = {};
    for (; !n.isEOF(); ) {
      if (a.code === 0) {
        n.rewind();
        break;
      }
      switch (a.code) {
        case 100:
          t.subclassMarker = a.value, a = n.next();
          break;
        case 2:
          t.name = a.value, a = n.next();
          break;
        case 5:
          t.handle = a.value, a = n.next();
          break;
        case 10:
          t.startPoint = wr(he(n)), a = n.lastReadGroup;
          break;
        case 11:
          t.directionVector = wr(he(n)), a = n.lastReadGroup;
          break;
        case 90:
          t.tableValue = a.value, a = n.next();
          break;
        case 91:
          t.rowCount = a.value, a = n.next();
          break;
        case 92:
          t.columnCount = a.value, a = n.next();
          break;
        case 93:
          t.overrideFlag = a.value, a = n.next();
          break;
        case 94:
          t.borderColorOverrideFlag = a.value, a = n.next();
          break;
        case 95:
          t.borderLineWeightOverrideFlag = a.value, a = n.next();
          break;
        case 96:
          t.borderVisibilityOverrideFlag = a.value, a = n.next();
          break;
        case 141:
          t.rowHeightArr ?? (t.rowHeightArr = []), t.rowHeightArr.push(a.value), a = n.next();
          break;
        case 142:
          t.columnWidthArr ?? (t.columnWidthArr = []), t.columnWidthArr.push(a.value), a = n.next();
          break;
        case 280:
          t.version = a.value, a = n.next();
          break;
        case 310:
          t.bmpPreview ?? (t.bmpPreview = ""), t.bmpPreview += a.value, a = n.next();
          break;
        case 330:
          t.ownerBlockRecordSoftId = a.value, a = n.next();
          break;
        case 342:
          t.tableStyleId = a.value, a = n.next();
          break;
        case 343:
          t.blockRecordHandle = a.value, a = n.next();
          break;
        case 170:
          t.attachmentPoint = a.value, a = n.next();
          break;
        case 171:
          t.cells ?? (t.cells = []), t.cells.push(function(s, o) {
            let c = !1, f = !1, d = {};
            for (; !s.isEOF() && o.code !== 0 && !f; ) switch (o.code) {
              case 171:
                if (c) {
                  f = !0;
                  continue;
                }
                d.cellType = o.value, c = !0, o = s.next();
                break;
              case 172:
                d.flagValue = o.value, o = s.next();
                break;
              case 173:
                d.mergedValue = o.value, o = s.next();
                break;
              case 174:
                d.autoFit = o.value, o = s.next();
                break;
              case 175:
                d.borderWidth = o.value, o = s.next();
                break;
              case 176:
                d.borderHeight = o.value, o = s.next();
                break;
              case 91:
                d.overrideFlag = o.value, o = s.next();
                break;
              case 178:
                d.virtualEdgeFlag = o.value, o = s.next();
                break;
              case 145:
                d.rotation = o.value, o = s.next();
                break;
              case 345:
                d.fieldObjetId = o.value, o = s.next();
                break;
              case 340:
                d.blockTableRecordId = o.value, o = s.next();
                break;
              case 146:
                d.blockScale = o.value, o = s.next();
                break;
              case 177:
                d.blockAttrNum = o.value, o = s.next();
                break;
              case 7:
                d.textStyle = o.value, o = s.next();
                break;
              case 140:
                d.textHeight = o.value, o = s.next();
                break;
              case 170:
                d.attachmentPoint = o.value, o = s.next();
                break;
              case 92:
                d.extendedCellFlags = o.value, o = s.next();
                break;
              case 285:
                d.rightBorderVisibility = !!(o.value ?? !0), o = s.next();
                break;
              case 286:
                d.bottomBorderVisibility = !!(o.value ?? !0), o = s.next();
                break;
              case 288:
                d.leftBorderVisibility = !!(o.value ?? !0), o = s.next();
                break;
              case 289:
                d.topBorderVisibility = !!(o.value ?? !0), o = s.next();
                break;
              case 301:
                (function(l, m, b) {
                  for (; b.code !== 304; ) switch (b.code) {
                    case 301:
                    case 93:
                    case 90:
                    case 94:
                      b = m.next();
                      break;
                    case 1:
                      l.text = b.value, b = m.next();
                      break;
                    case 300:
                      l.attrText = b.value, b = m.next();
                      break;
                    case 302:
                      l.text = b.value ? b.value : l.text, b = m.next();
                      break;
                    default:
                      b = m.next();
                  }
                })(d, s, o), o = s.next();
                break;
              default:
                return d;
            }
            return c = !1, f = !1, d;
          }(n, a)), a = n.lastReadGroup;
          break;
        default:
          Yn(t, a, n), a = n.next();
      }
    }
    return t;
  }
}
function Qa(e, n, a) {
  return n in e ? Object.defineProperty(e, n, { value: a, enumerable: !0, configurable: !0, writable: !0 }) : e[n] = a, e;
}
(Ar = "ForEntityName") in mr ? Object.defineProperty(mr, Ar, { value: "ACAD_TABLE", enumerable: !0, configurable: !0, writable: !0 }) : mr[Ar] = "ACAD_TABLE";
let qt = [{ code: 11, name: "xAxisDirection", parser: i }, { code: 210, name: "extrusionDirection", parser: i }, { code: 1, name: "text", parser: r }, { code: 10, name: "position", parser: i }, { code: 3, name: "styleName", parser: r }, { code: 100, name: "subclassMarker", parser: r }, ...E];
class en {
  parseEntity(n, a) {
    let t = {};
    return this.parser(a, n, t), t;
  }
  constructor() {
    Qa(this, "parser", p(qt));
  }
}
Qa(en, "ForEntityName", "TOLERANCE");
(L = {})[L.CREATED_BY_CURVE_FIT = 1] = "CREATED_BY_CURVE_FIT", L[L.TANGENT_DEFINED = 2] = "TANGENT_DEFINED", L[L.NOT_USED = 4] = "NOT_USED", L[L.CREATED_BY_SPLINE_FIT = 8] = "CREATED_BY_SPLINE_FIT", L[L.SPLINE_CONTROL_POINT = 16] = "SPLINE_CONTROL_POINT", L[L.FOR_POLYLINE = 32] = "FOR_POLYLINE", L[L.FOR_POLYGON = 64] = "FOR_POLYGON", L[L.POLYFACE = 128] = "POLYFACE";
let Qt = [{ code: [335, 343, 344, 91], name: "softPointers", isMultiple: !0, parser: r }, { code: 361, name: "sunId", parser: r }, { code: 431, name: "ambientLightColorName", parser: r }, { code: 421, name: "ambientLightColorInstance", parser: r }, { code: 63, name: "ambientLightColorIndex", parser: r }, { code: 142, name: "contrast", parser: r }, { code: 141, name: "brightness", parser: r }, { code: 282, name: "defaultLightingType", parser: r }, { code: 292, name: "isDefaultLighting", parser: u }, { code: 348, name: "visualStyleId", parser: r }, { code: 333, name: "shadePlotId", parser: r }, { code: 332, name: "backgroundId", parser: r }, { code: 61, name: "majorGridFrequency", parser: r }, { code: 170, name: "shadePlotMode", parser: r }, { code: 146, name: "elevation", parser: r }, { code: 79, name: "orthographicType", parser: r }, { code: 346, name: "ucsBaseId", parser: r }, { code: 345, name: "ucsId", parser: r }, { code: 112, name: "ucsYAxis", parser: i }, { code: 111, name: "ucsXAxis", parser: i }, { code: 110, name: "ucsOrigin", parser: i }, { code: 74, name: "iconFlag", parser: r }, { code: 71, name: "ucsPerViewport", parser: r }, { code: 281, name: "renderMode", parser: r }, { code: 1, name: "sheetName", parser: r }, { code: 340, name: "clippingBoundaryId", parser: r }, { code: 90, name: "statusBitFlags", parser: r }, { code: 331, name: "frozenLayerIds", isMultiple: !0, parser: r }, { code: 72, name: "circleZoomPercent", parser: r }, { code: 51, name: "viewTwistAngle", parser: r }, { code: 50, name: "snapAngle", parser: r }, { code: 45, name: "viewHeight", parser: r }, { code: 44, name: "backClipZ", parser: r }, { code: 43, name: "frontClipZ", parser: r }, { code: 42, name: "perspectiveLensLength", parser: r }, { code: 17, name: "targetPoint", parser: i }, { code: 16, name: "viewDirection", parser: i }, { code: 15, name: "gridSpacing", parser: i }, { code: 14, name: "snapSpacing", parser: i }, { code: 13, name: "snapBase", parser: i }, { code: 12, name: "displayCenter", parser: i }, { code: 69, name: "viewportId", parser: r }, { code: 68, name: "status", parser: r }, { code: 41, name: "height", parser: r }, { code: 40, name: "width", parser: r }, { code: 10, name: "viewportCenter", parser: i }, { code: 100, name: "subclassMarker", parser: r, pushContext: !0 }, ...E];
class fr {
  parseEntity(n, a) {
    let t = {};
    return p(Qt)(a, n, t), t;
  }
}
function rn(e, n, a) {
  return n in e ? Object.defineProperty(e, n, { value: a, enumerable: !0, configurable: !0, writable: !0 }) : e[n] = a, e;
}
(Dr = "ForEntityName") in fr ? Object.defineProperty(fr, Dr, { value: "VIEWPORT", enumerable: !0, configurable: !0, writable: !0 }) : fr[Dr] = "VIEWPORT";
let eo = { brightness: 50, constrast: 50, fade: 0 }, ro = [{ code: 14, name: "boundary", isMultiple: !0, parser: i }, { code: 91, name: "numberOfVertices", parser: r }, { code: 71, name: "boundaryType", parser: r }, { code: 360, name: "imageDefReactorHardId", parser: r }, { code: 283, name: "fade", parser: r }, { code: 282, name: "contrast", parser: r }, { code: 281, name: "brightness", parser: r }, { code: 280, name: "isClipping", parser: u }, { code: 70, name: "displayFlag", parser: r }, { code: 340, name: "imageDefHardId", parser: r }, { code: 13, name: "imageSize", parser: i }, { code: 12, name: "vDirection", parser: i }, { code: 11, name: "uDirection", parser: i }, { code: 10, name: "position", parser: i }, { code: 90, name: "classVersion", parser: r }, { code: 100, name: "subclassMarker", parser: r }, ...E];
class an {
  parseEntity(n, a) {
    let t = {};
    return this.parser(a, n, t), t;
  }
  constructor() {
    rn(this, "parser", p(ro, eo));
  }
}
rn(an, "ForEntityName", "WIPEOUT");
(de = {})[de.ShowImage = 1] = "ShowImage", de[de.ShowImageWhenNotAligned = 2] = "ShowImageWhenNotAligned", de[de.UseClippingBoundary = 4] = "UseClippingBoundary", de[de.Transparency = 8] = "Transparency";
function nn(e, n, a) {
  return n in e ? Object.defineProperty(e, n, { value: a, enumerable: !0, configurable: !0, writable: !0 }) : e[n] = a, e;
}
let ao = [{ code: 11, name: "direction", parser: i }, { code: 10, name: "position", parser: i }, { code: 100, name: "subclassMarker", parser: r }, ...E];
class tn {
  parseEntity(n, a) {
    let t = {};
    return this.parser(a, n, t), t;
  }
  constructor() {
    nn(this, "parser", p(ao));
  }
}
nn(tn, "ForEntityName", "XLINE");
let no = 0;
function on(e) {
  if (!e) throw TypeError("entity cannot be undefined or null");
  e.handle || (e.handle = no++);
}
let to = Object.fromEntries([cr, zr, dr, ea, ta, sa, ca, lr, da, pa, ha, ga, ya, Sa, Oa, pr, Aa, ka, aa, Ca, wa, Ra, Ba, Ua, Ga, ja, Xa, Ka, $a, qa, mr, qr, en, ba, Pr, fr, an, tn].map((e) => [e.ForEntityName, new e()]));
function sn(e, n) {
  let a = [];
  for (; !h(e, 0, "EOF"); ) {
    if (e.code === 0) {
      if (e.value === "ENDBLK" || e.value === "ENDSEC") {
        n.rewind();
        break;
      }
      let t = to[e.value];
      if (t) {
        let s = e.value;
        e = n.next();
        let o = t.parseEntity(n, e);
        o.type = s, on(o), a.push(o);
      } else n.debug;
    }
    e = n.next();
  }
  return a;
}
function oo(e, n) {
  let a = null, t = {};
  for (; !h(e, 0, "EOF") && !h(e, 0, "ENDSEC"); ) e.code === 9 ? a = typeof e.value == "string" ? e.value : null : a != null && (e.code === 10 ? t[a] = he(n) : t[a] = e.value), e = n.next();
  return t;
}
let fe = [{ code: 100, name: "subclassMarker", parser: r }, { code: 330, name: "ownerObjectId", parser: r }, { code: 102, isMultiple: !0, parser(e, n) {
  for (; !h(e, 0, "EOF") && !h(e, 102, "}"); ) e = n.next();
} }, { code: 5, name: "handle", parser: r }], so = [{ code: 70, name: "flag", parser: r }, { code: 2, name: "appName", parser: r }, { code: 100, name: "subclassMarker", parser: r }, ...fe], io = p(so), co = p([{ code: 310, name: "bmpPreview", parser: r }, { code: 281, name: "scalability", parser: r }, { code: 280, name: "explodability", parser: r }, { code: 70, name: "insertionUnits", parser: r }, { code: 340, name: "layoutObjects", parser: r }, { code: 2, name: "name", parser: r }, { code: 100, name: "subclassMarker", parser: r }, ...fe]), lo = p([...Rr.map((e) => ({ ...e, parser: r })), { code: 70, name: "standardFlag", parser: r }, { code: 2, name: "name", parser: r }, { code: 100, name: "subclassMarker", parser: r }, { code: 105, name: "handle", parser: r }, ...fe.filter((e) => e.code !== 5)]), uo = p([{ code: 347, name: "materialObjectId", parser: r }, { code: 390, name: "plotStyleNameObjectId", parser: r }, { code: 370, name: "lineweight", parser: r }, { code: 290, name: "isPlotting", parser: u }, { code: 6, name: "lineType", parser: r }, { code: 62, name: "colorIndex", parser: r }, { code: 70, name: "standardFlag", parser: r }, { code: 2, name: "name", parser: r }, { code: 100, name: "subclassMarker", parser: r }, ...fe]), po = p([{ code: 9, name: "text", parser: r }, { code: 45, name: "offsetY", parser: r }, { code: 44, name: "offsetX", parser: r }, { code: 50, name: "rotation", parser: r }, { code: 46, name: "scale", parser: r }, { code: 340, name: "styleObjectId", parser: r }, { code: 75, name: "shapeNumber", parser: r }, { code: 74, name: "elementTypeFlag", parser: r }, { code: 49, name: "elementLength", parser: r }], { elementTypeFlag: 0, elementLength: 0 }), mo = p([{ code: 49, name: "pattern", parser(e, n) {
  let a = {};
  return po(e, n, a), a;
}, isMultiple: !0 }, { code: 40, name: "totalPatternLength", parser: r }, { code: 73, name: "numberOfLineTypes", parser: r }, { code: 72, parser: r }, { code: 3, name: "description", parser: r }, { code: 70, name: "standardFlag", parser: r }, { code: 2, name: "name", parser: r }, { code: 100, name: "subclassMarker", parser: r }, ...fe]), fo = p([{ code: 1e3, name: "extendedFont", parser: r }, { code: 1001 }, { code: 4, name: "bigFont", parser: r }, { code: 3, name: "font", parser: r }, { code: 42, name: "lastHeight", parser: r }, { code: 71, name: "textGenerationFlag", parser: r }, { code: 50, name: "obliqueAngle", parser: r }, { code: 41, name: "widthFactor", parser: r }, { code: 40, name: "fixedTextHeight", parser: r }, { code: 70, name: "standardFlag", parser: r }, { code: 2, name: "name", parser: r }, { code: 100, name: "subclassMarker", parser: r }, ...fe]), bo = [{ code: 13, name: "orthographicOrigin", parser: i }, { code: 71, name: "orthographicType", parser: r }, { code: 346, name: "baseUcsHandle", parser: r }, { code: 146, name: "elevation", parser: r }, { code: 79, name: "isOrthographic", parser: u }, { code: 12, name: "yAxis", parser: i }, { code: 11, name: "xAxis", parser: i }, { code: 10, name: "origin", parser: i }, { code: 70, name: "flag", parser: r }, { code: 2, name: "name", parser: r }, { code: 100, name: "subclassMarker", parser: r }, ...fe], Io = p(bo), ho = [{ code: 346, name: "baseUcsId", parser: r }, { code: 345, name: "ucsId", parser: r }, { code: 146, name: "elevation", parser: r }, { code: 79, name: "orthographicType", parser: r }, { code: 112, name: "ucsYAxis", parser: i }, { code: 111, name: "ucsXAxis", parser: i }, { code: 110, name: "ucsOrigin", parser: i }, { code: 361, name: "sunHardId", parser: r }, { code: 348, name: "styleHardId", parser: r }, { code: 334, name: "liveSectionSoftId", parser: r }, { code: 332, name: "backgroundSoftId", parser: r }, { code: 73, name: "isPlottable", parser: u }, { code: 72, name: "isUcsAssociated", parser: u }, { code: 281, name: "renderMode", parser: r }, { code: 71, name: "viewMode", parser: r }, { code: 50, name: "twistAngle", parser: r }, { code: 44, name: "backClippingPlane", parser: r }, { code: 43, name: "frontClippingPlane", parser: r }, { code: 42, name: "lensLength", parser: r }, { code: 12, name: "target", parser: i }, { code: 11, name: "direction", parser: i }, { code: 10, name: "center", parser: i }, { code: 41, name: "width", parser: r }, { code: 40, name: "height", parser: r }, { code: 70, name: "flag", parser: r }, { code: 2, name: "name", parser: r }, { code: 100, name: "subclassMarker", parser: r }, ...fe], Eo = p(ho), go = p([{ code: [63, 421, 431], name: "ambientColor", parser: r }, { code: 142, name: "contrast", parser: r }, { code: 141, name: "brightness", parser: r }, { code: 282, name: "defaultLightingType", parser: r }, { code: 292, name: "isDefaultLightingOn", parser: u }, { code: 348, name: "visualStyleObjectId", parser: r }, { code: 333, name: "shadePlotObjectId", parser: r }, { code: 332, name: "backgroundObjectId", parser: r }, { code: 61, name: "majorGridLines", parser: r }, { code: 170, name: "shadePlotSetting", parser: r }, { code: 146, name: "elevation", parser: r }, { code: 79, name: "orthographicType", parser: r }, { code: 112, name: "ucsYAxis", parser: i }, { code: 111, name: "ucsXAxis", parser: i }, { code: 110, name: "ucsOrigin", parser: i }, { code: 74, name: "ucsIconSetting", parser: r }, { code: 71, name: "viewMode", parser: r }, { code: 281, name: "renderMode", parser: r }, { code: 1, name: "styleSheet", parser: r }, { code: [331, 441], name: "frozenLayers", parser: r, isMultiple: !0 }, { code: 72, name: "circleSides", parser: r }, { code: 51, name: "viewTwistAngle", parser: r }, { code: 50, name: "snapRotationAngle", parser: r }, { code: 45, name: "viewHeight", parser: r }, { code: 44, name: "backClippingPlane", parser: r }, { code: 43, name: "frontClippingPlane", parser: r }, { code: 42, name: "lensLength", parser: r }, { code: 41, name: "aspectRatio", parser: r }, { code: 40, name: "viewHeight", parser: r }, { code: 17, name: "viewTarget", parser: i }, { code: 16, name: "viewDirectionFromTarget", parser: i }, { code: 15, name: "gridSpacing", parser: i }, { code: 14, name: "snapSpacing", parser: i }, { code: 13, name: "snapBasePoint", parser: i }, { code: 12, name: "center", parser: i }, { code: 11, name: "upperRightCorner", parser: i }, { code: 10, name: "lowerLeftCorner", parser: i }, { code: 70, name: "standardFlag", parser: r }, { code: 2, name: "name", parser: r }, { code: 100, name: "subclassMarker", parser: r }, ...fe]), xo = { APPID: io, BLOCK_RECORD: co, DIMSTYLE: lo, LAYER: uo, LTYPE: mo, STYLE: fo, UCS: Io, VIEW: Eo, VPORT: go }, yo = p([{ code: 70, name: "maxNumberOfEntries", parser: r }, { code: 100, name: "subclassMarker", parser: r }, { code: 330, name: "ownerObjectId", parser: r }, { code: 102, parser: J }, { code: 102, parser: J }, { code: 102, parser: J }, { code: 360, isMultiple: !0 }, { code: 5, name: "handle", parser: r }, { code: 2, name: "name", parser: r }]);
function vo(e, n) {
  var t;
  let a = {};
  for (; !h(e, 0, "EOF") && !h(e, 0, "ENDSEC"); ) {
    if (h(e, 0, "TABLE")) {
      e = n.next();
      let s = { entries: [] };
      yo(e, n, s), a[s.name] = s;
    }
    if (h(e, 0) && !h(e, 0, "ENDTAB")) {
      let s = e.value;
      e = n.next();
      let o = xo[s];
      if (!o) {
        n.debug, e = n.next();
        continue;
      }
      let c = {};
      o(e, n, c), s === "VPORT" && (c.lowerLeftCorner == null && (c.lowerLeftCorner = { x: 0, y: 0 }), c.upperRightCorner == null && (c.upperRightCorner = { x: 1, y: 1 }), c.center == null && (c.center = { x: 0, y: 0 }), c.snapBasePoint == null && (c.snapBasePoint = { x: 0, y: 0 }), c.snapSpacing == null && (c.snapSpacing = { x: 0, y: 0 }), c.gridSpacing == null && (c.gridSpacing = { x: 0, y: 0 }), c.viewDirectionFromTarget == null && (c.viewDirectionFromTarget = { x: 0, y: 0, z: 1 }), c.viewTarget == null && (c.viewTarget = { x: 0, y: 0, z: 0 })), (t = a[s]) == null || t.entries.push(c);
    }
    e = n.next();
  }
  return a;
}
function So(e, n) {
  let a = {};
  for (; !h(e, 0, "EOF") && !h(e, 0, "ENDSEC"); ) {
    if (h(e, 0, "BLOCK")) {
      let t = To(e = n.next(), n);
      on(t), t.name && (a[t.name] = t);
    }
    e = n.next();
  }
  return a;
}
function To(e, n) {
  let a = {};
  for (; !h(e, 0, "EOF"); ) {
    if (h(e, 0, "ENDBLK")) {
      for (e = n.next(); !h(e, 0, "EOF"); ) {
        if (h(e, 100, "AcDbBlockEnd")) return a;
        e = n.next();
      }
      break;
    }
    switch (e.code) {
      case 1:
        a.xrefPath = e.value;
        break;
      case 2:
        a.name = e.value;
        break;
      case 3:
        a.name2 = e.value;
        break;
      case 5:
        a.handle = e.value;
        break;
      case 8:
        a.layer = e.value;
        break;
      case 10:
        a.position = he(n);
        break;
      case 67:
        a.paperSpace = !!e.value && e.value == 1;
        break;
      case 70:
        e.value !== 0 && (a.type = e.value);
        break;
      case 100:
        break;
      case 330:
        a.ownerHandle = e.value;
        break;
      case 0:
        a.entities = sn(e, n);
    }
    e = n.next();
  }
  return a;
}
let be = [{ code: 330, name: "ownerObjectId", parser: r }, { code: 102, parser: J }, { code: 102, parser: J }, { code: 102, parser: J }, { code: 5, name: "handle", parser: r }], cn = [{ code: 333, name: "shadePlotId", parser: r }, { code: 149, name: "imageOriginY", parser: r }, { code: 148, name: "imageOriginX", parser: r }, { code: 147, name: "scaleFactor", parser: r }, { code: 78, name: "shadePlotCustomDPI", parser: r }, { code: 77, name: "shadePlotResolution", parser: r }, { code: 76, name: "shadePlotMode", parser: r }, { code: 75, name: "standardScaleType", parser: r }, { code: 7, name: "currentStyleSheet", parser: r }, { code: 74, name: "plotType", parser: r }, { code: 73, name: "plotRotation", parser: r }, { code: 72, name: "plotPaperUnit", parser: r }, { code: 70, name: "layoutFlag", parser: r }, { code: 143, name: "printScaleDenominator", parser: r }, { code: 142, name: "printScaleNumerator", parser: r }, { code: 141, name: "windowAreaYMax", parser: r }, { code: 140, name: "windowAreaXMax", parser: r }, { code: 49, name: "windowAreaYMin", parser: r }, { code: 48, name: "windowAreaXMin", parser: r }, { code: 47, name: "plotOriginY", parser: r }, { code: 46, name: "plotOriginX", parser: r }, { code: 45, name: "paperHeight", parser: r }, { code: 44, name: "paperWidth", parser: r }, { code: 43, name: "marginTop", parser: r }, { code: 42, name: "marginRight", parser: r }, { code: 41, name: "marginBottom", parser: r }, { code: 40, name: "marginLeft", parser: r }, { code: 6, name: "plotViewName", parser: r }, { code: 4, name: "paperSize", parser: r }, { code: 2, name: "configName", parser: r }, { code: 1, name: "pageSetupName", parser: r }, { code: 100, name: "subclassMarker", parser: r }, ...be], Oo = [{ code: 346, name: "orthographicUcsId", parser: r }, { code: 345, name: "namedUcsId", parser: r }, { code: 331, name: "viewportId", parser: r }, { code: 330, name: "paperSpaceTableId", parser: r }, { code: 76, name: "orthographicType", parser: r }, { code: 17, name: "ucsYAxis", parser: i }, { code: 16, name: "ucsXAxis", parser: i }, { code: 13, name: "ucsOrigin", parser: i }, { code: 146, name: "elevation", parser: r }, { code: 15, name: "maxExtent", parser: i }, { code: 14, name: "minExtent", parser: i }, { code: 12, name: "insertionPoint", parser: i }, { code: 11, name: "maxLimit", parser: i }, { code: 10, name: "minLimit", parser: i }, { code: 71, name: "tabOrder", parser: r }, { code: 70, name: "controlFlag", parser: r }, { code: 1, name: "layoutName", parser: r }, { code: 100, name: "subclassMarker", parser: r }, ...cn], No = [{ code: 3, name: "entries", parser: (e, n) => {
  let a = { name: e.value };
  return (e = n.next()).code === 350 ? a.objectSoftId = e.value : e.code === 360 ? a.objectHardId = e.value : n.rewind(), a;
}, isMultiple: !0 }, { code: 281, name: "recordCloneFlag", parser: r }, { code: 280, name: "isHardOwned", parser: u }, { code: 100, name: "subclassMarker", parser: r }, ...be], Ao = [{ code: 40, name: "wcsToOCSTransform", parser: Wr }, { code: 40, name: "ocsToWCSTransform", parser: Wr }, { code: 41, name: "backClippingDistance", parser: r }, { code: 73, name: "isBackClipping", parser: u, pushContext: !0 }, { code: 40, name: "frontClippingDistance", parser: r }, { code: 72, name: "isFrontClipping", parser: u, pushContext: !0 }, { code: 71, name: "isClipBoundaryDisplayed", parser: u }, { code: 11, name: "position", parser: i }, { code: 210, name: "normal", parser: i }, { code: 10, name: "boundaryVertices", parser: i, isMultiple: !0 }, { code: 70, name: "boundaryCount", parser: r }, { code: 100, name: "subclassMarker", parser: r }, { code: 100 }, ...be];
function Wr(e, n) {
  let a = [];
  for (let t = 0; t < 3 && h(e, 40); ++t) {
    let s = [];
    for (let o = 0; o < 4 && h(e, 40); ++o) s.push(e.value), e = n.next();
    a.push(s);
  }
  return n.rewind(), a;
}
let Do = [{ code: 330, name: "imageDefReactorIdSoft", isMultiple: !0, parser: r }, { code: 90, name: "version", parser: r }, { code: 1, name: "fileName", parser: r }, { code: 10, name: "size", parser: i }, { code: 11, name: "sizeOfOnePixel", parser: i }, { code: 280, name: "isLoaded", parser: r }, { code: 281, name: "resolutionUnits", parser: r }, { code: 100, name: "subclassMarker", parser: r }], ko = [{ code: 179, name: "unknown1", parser: r }, { code: 170, name: "contentType", parser: r }, { code: 171, name: "drawMLeaderOrderType", parser: r }, { code: 172, name: "drawLeaderOrderType", parser: r }, { code: 90, name: "maxLeaderSegmentPoints", parser: r }, { code: 40, name: "firstSegmentAngleConstraint", parser: r }, { code: 41, name: "secondSegmentAngleConstraint", parser: r }, { code: 173, name: "leaderLineType", parser: r }, { code: 91, name: "leaderLineColor", parser: r }, { code: 340, name: "leaderLineTypeId", parser: r }, { code: 92, name: "leaderLineWeight", parser: r }, { code: 290, name: "landingEnabled", parser: u }, { code: 42, name: "landingGap", parser: r }, { code: 291, name: "doglegEnabled", parser: u }, { code: 43, name: "doglegLength", parser: r }, { code: 3, name: "description", parser: r }, { code: 341, name: "arrowheadId", parser: r }, { code: 44, name: "arrowheadSize", parser: r }, { code: 300, name: "defaultMTextContents", parser: r }, { code: 342, name: "textStyleId", parser: r }, { code: 174, name: "textLeftAttachmentType", parser: r }, { code: 175, name: "textAngleType", parser: r }, { code: 176, name: "textAlignmentType", parser: r }, { code: 178, name: "textRightAttachmentType", parser: r }, { code: 93, name: "textColor", parser: r }, { code: 45, name: "textHeight", parser: r }, { code: 292, name: "textFrameEnabled", parser: u }, { code: 297, name: "textAlignAlwaysLeft", parser: u }, { code: 46, name: "alignSpace", parser: r }, { code: 343, name: "blockContentId", parser: r }, { code: 94, name: "blockContentColor", parser: r }, { code: 47, name: "blockContentScale.x", parser: r }, { code: 49, name: "blockContentScale.y", parser: r }, { code: 140, name: "blockContentScale.z", parser: r }, { code: 293, name: "blockContentScaleEnabled", parser: u }, { code: 141, name: "blockContentRotation", parser: r }, { code: 294, name: "blockContentRotationEnabled", parser: u }, { code: 177, name: "blockContentConnectionType", parser: r }, { code: 142, name: "scale", parser: r }, { code: 295, name: "overwritePropertyValue", parser: u }, { code: 296, name: "annotative", parser: u }, { code: 143, name: "breakGapSize", parser: r }, { code: 271, name: "textAttachmentDirection", parser: r }, { code: 272, name: "bottomTextAttachmentDirection", parser: r }, { code: 273, name: "topTextAttachmentDirection", parser: r }, { code: 298, name: "unknown2", parser: r }, { code: 100, name: "subclassMarker", parser: r }, ...be];
function or(e, n, a) {
  e.elements || (e.elements = []);
  let t = e.elements.find((s) => s[n] === void 0);
  if (t) {
    t[n] = a;
    return;
  }
  e.elements.push({ [n]: a });
}
let Lo = [{ code: 6, parser: function({ value: e }, n, a) {
  or(a, "lineType", e);
}, isMultiple: !0 }, { code: 62, parser: function({ value: e }, n, a) {
  var t;
  if (a.fillColorIndex === void 0 && !((t = a.elements) != null && t.length)) {
    a.fillColorIndex = e;
    return;
  }
  or(a, "colorIndex", e);
}, isMultiple: !0 }, { code: 420, parser: function({ value: e }, n, a) {
  var t;
  if (a.fillColor === void 0 && !((t = a.elements) != null && t.length)) {
    a.fillColor = e;
    return;
  }
  or(a, "color", e);
}, isMultiple: !0 }, { code: 49, parser: function({ value: e }, n, a) {
  or(a, "offset", e);
}, isMultiple: !0 }, { code: 71, name: "elementCount", parser: r }, { code: 52, name: "endAngle", parser: r }, { code: 51, name: "startAngle", parser: r }, { code: 3, name: "description", parser: r }, { code: 70, name: "flags", parser: r }, { code: 2, name: "styleName", parser: r }, { code: 100, name: "subclassMarker", parser: r }, ...be], Co = [{ code: 340, name: "entityIds", parser: r, isMultiple: !0 }, { code: 71, name: "isSelectable", parser: u }, { code: 70, name: "isUnnamed", parser: u }, { code: 300, name: "description", parser: r }, { code: 100, name: "subclassMarker", parser: r }, ...be], Mo = [{ code: 8, name: "layerNames", parser: r, isMultiple: !0 }, { code: 100, name: "subclassMarker", parser: r }, { code: 100, name: "filterSubclassMarker", parser: r }, ...be], wo = [{ code: 90, name: "idBufferEntryCounts", parser: r, isMultiple: !0 }, { code: 360, name: "idBufferIds", parser: r, isMultiple: !0 }, { code: 8, name: "layerNames", parser: r, isMultiple: !0 }, { code: 100, name: "subclassMarker", parser: r }, { code: 40, name: "timeStamp", parser: r }, { code: 100, name: "indexSubclassMarker", parser: r }, ...be], _o = [{ code: 75, name: "hasLastPointRef", parser: u }, { code: 1, name: "pointRefs", parser: function(e, n) {
  let a = { className: e.value };
  for (; ; ) switch ((e = n.next()).code) {
    case 72:
      a.objectOsnapType = e.value;
      continue;
    case 331:
      a.mainObjectId = e.value;
      continue;
    case 73:
      a.mainObjectSubentityType = e.value;
      continue;
    case 91:
      a.mainObjectGsMarker = e.value;
      continue;
    case 301:
      a.mainObjectXrefHandle = e.value;
      continue;
    case 40:
      a.nearOsnapGeometryParameter = e.value;
      continue;
    case 10:
      {
        let t = i(e, n);
        a.osnapPoint = "z" in t ? t : { ...t, z: 0 };
      }
      continue;
    case 332:
      a.intersectionObjectId = e.value;
      continue;
    case 74:
      a.intersectionObjectSubentityType = e.value;
      continue;
    case 92:
      a.intersectionObjectGsMarker = e.value;
      continue;
    case 302:
      a.intersectionObjectXrefHandle = e.value;
      continue;
    default:
      return n.rewind(), a;
  }
}, isMultiple: !0 }, { code: 71, name: "rotatedDimensionType", parser: r }, { code: 70, name: "transSpaceFlag", parser: u }, { code: 90, name: "associativityFlag", parser: r }, { code: 330, name: "dimensionObjectId", parser: r }, { code: 100, name: "subclassMarker", parser: r }, ...be], Fo = { LAYOUT: Oo, PLOTSETTINGS: cn, DICTIONARY: No, SPATIAL_FILTER: Ao, IMAGEDEF: Do, MLEADERSTYLE: ko, MLINESTYLE: Lo, GROUP: Co, LAYER_FILTER: Mo, LAYER_INDEX: wo, DIMASSOC: _o };
function Ro(e, n) {
  let a = [];
  for (; e.code !== 0 || !["EOF", "ENDSEC"].includes(e.value); ) {
    let t = e.value, s = Fo[t];
    if (e.code === 0 && (s != null && s.length)) {
      let o = p(s), c = { name: t };
      o(e = n.next(), n, c) ? (a.push(c), e = n.peek()) : e = n.next();
    } else e = n.next();
  }
  return { byName: Hn(a, ({ name: t }) => t) };
}
let Re = new Uint8Array([...new TextEncoder().encode(`AutoCAD Binary DXF\r
`), 26, 0]), Po = new Set(M(290, 300)), Bo = /* @__PURE__ */ new Set([...M(60, 80), ...M(170, 180), ...M(270, 290), ...M(370, 390), ...M(400, 410), ...M(1060, 1071)]), Vo = /* @__PURE__ */ new Set([...M(90, 100), ...M(420, 430), ...M(440, 460), 1071]), Uo = new Set(M(160, 170)), Ho = /* @__PURE__ */ new Set([...M(10, 60), ...M(110, 150), ...M(210, 240), ...M(460, 470), ...M(1010, 1060)]), Go = /* @__PURE__ */ new Set([...M(310, 320), 1004]);
function Br(e) {
  if (e.length < Re.length) return !1;
  for (let n = 0; n < Re.length; n++) if (e[n] !== Re[n]) return !1;
  return !0;
}
function Wo(e) {
  return (e.charCodeAt(0) === 65279 ? e.slice(1) : e).startsWith("AutoCAD Binary DXF");
}
function jo(e, n = {}) {
  if (!Br(e)) throw Error("Not a binary DXF file.");
  let { dxfVersion: a, encoding: t, r12: s } = function(l, m, b) {
    let y, g = !function(F) {
      let _ = Re.length;
      return F.length < _ + 9 || (F[_] === 0 && F[_ + 1] === 0 ? Yr(F.subarray(_ + 2, _ + 9)) === "SECTION" : F[_] !== 0 || Yr(F.subarray(_ + 1, _ + 8)) !== "SECTION");
    }(l), S = new DataView(l.buffer, l.byteOffset, l.byteLength), v = jr(b), A = "AC1009", w = m, V = Re.length, Pe = Math.min(l.length, V + 8192);
    for (; V < Pe; ) {
      let [F, _] = sr(l, V, g), [Ie, Er] = ir(l, S, _, F, w, v);
      if (F === 9 && Ie === "$ACADVER") {
        let [_e, gr] = sr(l, Er, g), [xr, yr] = ir(l, S, gr, _e, "utf-8", v);
        _e === 1 && (A = xr), V = yr;
        continue;
      }
      if (F === 9 && Ie === "$DWGCODEPAGE") {
        let [_e, gr] = sr(l, Er, g), [xr, yr] = ir(l, S, gr, _e, "ascii", v);
        (_e === 3 || _e === 1) && (y = xr), V = yr;
        continue;
      }
      if (V = Er, F === 0 && (Ie === "ENDSEC" || Ie === "EOF")) break;
    }
    return A >= "AC1021" ? w = "utf-8" : y && (w = function(F) {
      let _ = /^ANSI_(\d+)$/i.exec(F);
      if (!_) return;
      let Ie = _[1];
      return Ie === "1252" ? "windows-1252" : Ie === "949" ? "euc-kr" : `windows-${Ie}`;
    }(y) ?? m), { dxfVersion: A, encoding: w, r12: g };
  }(e, n.encoding ?? "windows-1252", n.encodingFailureFatal ?? !1), o = [], c = new DataView(e.buffer, e.byteOffset, e.byteLength), f = jr(n.encodingFailureFatal ?? !1), d = Re.length;
  for (; d < e.length; ) {
    let [l, m] = sr(e, d, s), [b, y] = ir(e, c, d = m, l, t, f);
    if (d = y, o.push(String(l), b), l === 0 && b === "EOF") break;
  }
  if (o.length < 2 || o[o.length - 1] !== "EOF") throw Error(`Binary DXF ended without EOF group (version ${a}, offset ${d}).`);
  return o;
}
function sr(e, n, a) {
  if (a) {
    let t = e[n];
    return n += 1, t === 255 && (t = e[n] | e[n + 1] << 8, n += 2), [t, n];
  }
  return [e[n] | e[n + 1] << 8, n + 2];
}
function ir(e, n, a, t, s, o) {
  var c, f;
  let d;
  if (Go.has(t)) {
    let b = e[a];
    a += 1;
    let y = e.subarray(a, a + b);
    return a += b, [function(g) {
      let S = "";
      for (let v = 0; v < g.length; v++) S += g[v].toString(16).padStart(2, "0");
      return S;
    }(y), a];
  }
  if (Po.has(t)) return [e[a] !== 0 ? "1" : "0", a + 1];
  if (Bo.has(t)) return [String(n.getInt16(a, !0)), a + 2];
  if (Vo.has(t)) return [String(n.getInt32(a, !0)), a + 4];
  if (Uo.has(t)) return [String(Number(n.getBigInt64(a, !0))), a + 8];
  if (Ho.has(t)) return [String(n.getFloat64(a, !0)), a + 8];
  let l = a, m = l;
  for (; m < e.length && e[m] !== 0; ) m++;
  return [(c = o, f = s, (d = c.byEncoding.get(f)) || (d = new TextDecoder(f, { fatal: c.fatal }), c.byEncoding.set(f, d)), d).decode(e.subarray(l, m)), m + 1];
}
function jr(e) {
  return { fatal: e, byEncoding: /* @__PURE__ */ new Map() };
}
function M(e, n) {
  let a = [];
  for (let t = e; t < n; t++) a.push(t);
  return a;
}
function Yr(e) {
  return new TextDecoder("ascii").decode(e);
}
function ln(e) {
  if (Wo(e.charCodeAt(0) === 65279 ? e.slice(1) : e)) throw Error("Binary DXF cannot be parsed from a text string. Read the file as ArrayBuffer/Uint8Array and use DxfParser.parseBuffer() instead.");
  return (e.charCodeAt(0) === 65279 ? e.slice(1) : e).split(/\r\n|\r|\n/g);
}
function Yo(e, n = {}) {
  return Br(e) ? jo(e, { encoding: n.encoding, encodingFailureFatal: n.encodingFailureFatal }) : ln(new TextDecoder(n.encoding ?? "utf-8", { fatal: n.encodingFailureFatal ?? !1 }).decode(e));
}
function br(e, n, a) {
  return n in e ? Object.defineProperty(e, n, { value: a, enumerable: !0, configurable: !0, writable: !0 }) : e[n] = a, e;
}
class Xo {
  constructor() {
    br(this, "encoding", "utf-8"), br(this, "encodingFailureFatal", !1), br(this, "thumbnailImageFormat", "base64");
  }
}
class zo extends EventTarget {
  parseSync(n, a = !1) {
    return this.parseLines(ln(n), a);
  }
  parseBuffer(n, a = !1) {
    return this.parseLines(Yo(n, { encoding: this._options.encoding, encodingFailureFatal: this._options.encodingFailureFatal }), a);
  }
  parseStream(n) {
    let a = [], t = this;
    return new Promise((s, o) => {
      n.on("data", (c) => {
        typeof c == "string" ? a.push(new TextEncoder().encode(c)) : a.push(c);
      }), n.on("end", () => {
        try {
          let c = a.reduce((l, m) => l + m.length, 0), f = new Uint8Array(c), d = 0;
          for (let l of a) f.set(l, d), d += l.length;
          s(t.parseBuffer(f));
        } catch (c) {
          o(c);
        }
      }), n.on("error", (c) => {
        o(c);
      });
    });
  }
  async parseFromUrl(n, a) {
    let t = await fetch(n, a);
    if (!t.ok) throw Error(`Failed to fetch DXF: ${t.status} ${t.statusText}`);
    let s = await t.arrayBuffer();
    if (s.byteLength === 0) throw Error(`Failed to fetch DXF: empty response body from ${n}`);
    return this.parseBuffer(new Uint8Array(s));
  }
  parseLines(n, a = !1) {
    let t = new rt(n, a);
    if (!t.hasNext()) throw Error("Empty file");
    return this.parseAll(t);
  }
  parseAll(n) {
    let a = { header: {}, blocks: {}, entities: [], tables: {}, objects: { byName: {}, byTree: void 0 } }, t = n.next();
    for (; !h(t, 0, "EOF"); ) h(t, 0, "SECTION") && (h(t = n.next(), 2, "HEADER") ? a.header = oo(t = n.next(), n) : h(t, 2, "CLASSES") ? Nn(t = n.next(), n, a) : h(t, 2, "BLOCKS") ? a.blocks = So(t = n.next(), n) : h(t, 2, "ENTITIES") ? a.entities = sn(t = n.next(), n) : h(t, 2, "TABLES") ? a.tables = vo(t = n.next(), n) : h(t, 2, "OBJECTS") ? a.objects = Ro(t = n.next(), n) : h(t, 2, "THUMBNAILIMAGE") && (a.thumbnailImage = function(s, o, c = "base64") {
      let f, d = "", l = 0;
      for (; !h(s, 0, "EOF") && !h(s, 0, "ENDSEC"); ) s.code === 90 ? l = s.value : s.code === 310 && (d += s.value), s = o.next();
      if (c === "hex") f = d;
      else {
        let m = function(b) {
          let y = b.length / 2, g = new Uint8Array(y);
          for (let S = 0; S < y; S++) g[S] = parseInt(b.substr(2 * S, 2), 16);
          return g;
        }(d);
        f = c === "buffer" ? m : function(b) {
          let y = "";
          for (let g = 0; g < b.length; g++) y += String.fromCharCode(b[g]);
          return btoa(y);
        }(m);
      }
      return { size: l, data: f };
    }(t = n.next(), n, this._options.thumbnailImageFormat))), t = n.next();
    return a;
  }
  constructor(n = {}) {
    super(), br(this, "_options", void 0);
    let a = new Xo();
    this._options = Object.assign(a, n);
  }
}
(j = {})[j.NOT_APPLICABLE = 0] = "NOT_APPLICABLE", j[j.KEEP_EXISTING = 1] = "KEEP_EXISTING", j[j.USE_CLONE = 2] = "USE_CLONE", j[j.XREF_VALUE_NAME = 3] = "XREF_VALUE_NAME", j[j.VALUE_NAME = 4] = "VALUE_NAME", j[j.UNMANGLE_NAME = 5] = "UNMANGLE_NAME";
(Ce = {})[Ce.NOUNIT = 0] = "NOUNIT", Ce[Ce.CENTIMETERS = 2] = "CENTIMETERS", Ce[Ce.INCH = 5] = "INCH";
(er = {})[er.PSLTSCALE = 1] = "PSLTSCALE", er[er.LIMCHECK = 2] = "LIMCHECK";
(Me = {})[Me.INCHES = 0] = "INCHES", Me[Me.MILLIMETERS = 1] = "MILLIMETERS", Me[Me.PIXELS = 2] = "PIXELS";
(Y = {})[Y.LAST_SCREEN_DISPLAY = 0] = "LAST_SCREEN_DISPLAY", Y[Y.DRAWING_EXTENTS = 1] = "DRAWING_EXTENTS", Y[Y.DRAWING_LIMITS = 2] = "DRAWING_LIMITS", Y[Y.VIEW_SPECIFIED = 3] = "VIEW_SPECIFIED", Y[Y.WINDOW_SPECIFIED = 4] = "WINDOW_SPECIFIED", Y[Y.LAYOUT_INFORMATION = 5] = "LAYOUT_INFORMATION";
(ue = {})[ue.AS_DISPLAYED = 0] = "AS_DISPLAYED", ue[ue.WIREFRAME = 1] = "WIREFRAME", ue[ue.HIDDEN = 2] = "HIDDEN", ue[ue.RENDERED = 3] = "RENDERED";
(X = {})[X.DRAFT = 0] = "DRAFT", X[X.PREVIEW = 1] = "PREVIEW", X[X.NORMAL = 2] = "NORMAL", X[X.PRESENTATION = 3] = "PRESENTATION", X[X.MAXIMUM = 4] = "MAXIMUM", X[X.CUSTOM = 5] = "CUSTOM";
(pe = {})[pe.NONE = 0] = "NONE", pe[pe.AbsoluteRotation = 1] = "AbsoluteRotation", pe[pe.TextEmbedded = 2] = "TextEmbedded", pe[pe.ShapeEmbedded = 4] = "ShapeEmbedded";
(kr = {})[kr.PaperSpace = 1] = "PaperSpace";
(we = {})[we.XrefDependent = 16] = "XrefDependent", we[we.XrefResolved = 32] = "XrefResolved", we[we.Referenced = 64] = "Referenced";
(z = {})[z.Off = 0] = "Off", z[z.Perspective = 1] = "Perspective", z[z.ClipFront = 2] = "ClipFront", z[z.ClipBack = 4] = "ClipBack", z[z.UcsFollow = 8] = "UcsFollow", z[z.ClipFrontByFrontZ = 16] = "ClipFrontByFrontZ";
class Ko {
  parse(n) {
    const a = new Uint8Array(n), t = new zo();
    if (Br(a))
      return t.parseBuffer(a);
    const s = this.getDxfInfoFromBuffer(n);
    let o = "";
    return s.version && s.version.value <= 23 && s.encoding ? o = new TextDecoder(s.encoding).decode(n) : o = new TextDecoder().decode(n), t.parseSync(o);
  }
  getDxfInfoFromBuffer(n) {
    var l, m, b;
    const t = new TextDecoder("utf-8");
    let s = 0, o = "", c = null, f = null, d = !1;
    for (; s < n.byteLength; ) {
      const y = Math.min(s + 65536, n.byteLength), g = n.slice(s, y);
      s = y;
      const v = (o + t.decode(g, { stream: !0 })).split(/\r?\n/);
      o = v.pop() ?? "";
      for (let A = 0; A < v.length; A++) {
        const w = v[A].trim();
        if (w === "SECTION" && ((l = v[A + 2]) == null ? void 0 : l.trim()) === "HEADER")
          d = !0;
        else if (w === "ENDSEC" && d)
          return { version: c, encoding: f };
        if (d && w === "$ACADVER") {
          const V = (m = v[A + 2]) == null ? void 0 : m.trim();
          V && (c = new dn(V));
        } else if (d && w === "$DWGCODEPAGE") {
          const V = (b = v[A + 2]) == null ? void 0 : b.trim();
          if (V) {
            const Pe = Mr[V];
            f = bn(Pe);
          }
        }
        if (c && f)
          return { version: c, encoding: f };
      }
    }
    return { version: c, encoding: f };
  }
}
class Zo extends mn {
  async executeTask(n) {
    return new Ko().parse(n);
  }
}
new Zo();
