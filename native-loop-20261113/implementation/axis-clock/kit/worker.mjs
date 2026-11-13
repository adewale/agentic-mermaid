var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/xmlchars/xml/1.0/ed5.js
var require_ed5 = __commonJS({
  "node_modules/xmlchars/xml/1.0/ed5.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.CHAR = "	\n\r -\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}";
    exports.S = " 	\r\n";
    exports.NAME_START_CHAR = ":A-Z_a-z\xC0-\xD6\xD8-\xF6\xF8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u{10000}-\u{EFFFF}";
    exports.NAME_CHAR = "-" + exports.NAME_START_CHAR + ".0-9\xB7\u0300-\u036F\u203F-\u2040";
    exports.CHAR_RE = new RegExp("^[" + exports.CHAR + "]$", "u");
    exports.S_RE = new RegExp("^[" + exports.S + "]+$", "u");
    exports.NAME_START_CHAR_RE = new RegExp("^[" + exports.NAME_START_CHAR + "]$", "u");
    exports.NAME_CHAR_RE = new RegExp("^[" + exports.NAME_CHAR + "]$", "u");
    exports.NAME_RE = new RegExp("^[" + exports.NAME_START_CHAR + "][" + exports.NAME_CHAR + "]*$", "u");
    exports.NMTOKEN_RE = new RegExp("^[" + exports.NAME_CHAR + "]+$", "u");
    var TAB = 9;
    var NL = 10;
    var CR = 13;
    var SPACE = 32;
    exports.S_LIST = [SPACE, NL, CR, TAB];
    function isChar(c) {
      return c >= SPACE && c <= 55295 || c === NL || c === CR || c === TAB || c >= 57344 && c <= 65533 || c >= 65536 && c <= 1114111;
    }
    exports.isChar = isChar;
    function isS(c) {
      return c === SPACE || c === NL || c === CR || c === TAB;
    }
    exports.isS = isS;
    function isNameStartChar(c) {
      return c >= 65 && c <= 90 || c >= 97 && c <= 122 || c === 58 || c === 95 || c === 8204 || c === 8205 || c >= 192 && c <= 214 || c >= 216 && c <= 246 || c >= 248 && c <= 767 || c >= 880 && c <= 893 || c >= 895 && c <= 8191 || c >= 8304 && c <= 8591 || c >= 11264 && c <= 12271 || c >= 12289 && c <= 55295 || c >= 63744 && c <= 64975 || c >= 65008 && c <= 65533 || c >= 65536 && c <= 983039;
    }
    exports.isNameStartChar = isNameStartChar;
    function isNameChar(c) {
      return isNameStartChar(c) || c >= 48 && c <= 57 || c === 45 || c === 46 || c === 183 || c >= 768 && c <= 879 || c >= 8255 && c <= 8256;
    }
    exports.isNameChar = isNameChar;
  }
});

// node_modules/xmlchars/xml/1.1/ed2.js
var require_ed2 = __commonJS({
  "node_modules/xmlchars/xml/1.1/ed2.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.CHAR = "-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}";
    exports.RESTRICTED_CHAR = "-\b\v\f-\x7F-\x84\x86-\x9F";
    exports.S = " 	\r\n";
    exports.NAME_START_CHAR = ":A-Z_a-z\xC0-\xD6\xD8-\xF6\xF8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u{10000}-\u{EFFFF}";
    exports.NAME_CHAR = "-" + exports.NAME_START_CHAR + ".0-9\xB7\u0300-\u036F\u203F-\u2040";
    exports.CHAR_RE = new RegExp("^[" + exports.CHAR + "]$", "u");
    exports.RESTRICTED_CHAR_RE = new RegExp("^[" + exports.RESTRICTED_CHAR + "]$", "u");
    exports.S_RE = new RegExp("^[" + exports.S + "]+$", "u");
    exports.NAME_START_CHAR_RE = new RegExp("^[" + exports.NAME_START_CHAR + "]$", "u");
    exports.NAME_CHAR_RE = new RegExp("^[" + exports.NAME_CHAR + "]$", "u");
    exports.NAME_RE = new RegExp("^[" + exports.NAME_START_CHAR + "][" + exports.NAME_CHAR + "]*$", "u");
    exports.NMTOKEN_RE = new RegExp("^[" + exports.NAME_CHAR + "]+$", "u");
    var TAB = 9;
    var NL = 10;
    var CR = 13;
    var SPACE = 32;
    exports.S_LIST = [SPACE, NL, CR, TAB];
    function isChar(c) {
      return c >= 1 && c <= 55295 || c >= 57344 && c <= 65533 || c >= 65536 && c <= 1114111;
    }
    exports.isChar = isChar;
    function isRestrictedChar(c) {
      return c >= 1 && c <= 8 || c === 11 || c === 12 || c >= 14 && c <= 31 || c >= 127 && c <= 132 || c >= 134 && c <= 159;
    }
    exports.isRestrictedChar = isRestrictedChar;
    function isCharAndNotRestricted(c) {
      return c === 9 || c === 10 || c === 13 || c > 31 && c < 127 || c === 133 || c > 159 && c <= 55295 || c >= 57344 && c <= 65533 || c >= 65536 && c <= 1114111;
    }
    exports.isCharAndNotRestricted = isCharAndNotRestricted;
    function isS(c) {
      return c === SPACE || c === NL || c === CR || c === TAB;
    }
    exports.isS = isS;
    function isNameStartChar(c) {
      return c >= 65 && c <= 90 || c >= 97 && c <= 122 || c === 58 || c === 95 || c === 8204 || c === 8205 || c >= 192 && c <= 214 || c >= 216 && c <= 246 || c >= 248 && c <= 767 || c >= 880 && c <= 893 || c >= 895 && c <= 8191 || c >= 8304 && c <= 8591 || c >= 11264 && c <= 12271 || c >= 12289 && c <= 55295 || c >= 63744 && c <= 64975 || c >= 65008 && c <= 65533 || c >= 65536 && c <= 983039;
    }
    exports.isNameStartChar = isNameStartChar;
    function isNameChar(c) {
      return isNameStartChar(c) || c >= 48 && c <= 57 || c === 45 || c === 46 || c === 183 || c >= 768 && c <= 879 || c >= 8255 && c <= 8256;
    }
    exports.isNameChar = isNameChar;
  }
});

// node_modules/xmlchars/xmlns/1.0/ed3.js
var require_ed3 = __commonJS({
  "node_modules/xmlchars/xmlns/1.0/ed3.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.NC_NAME_START_CHAR = "A-Z_a-z\xC0-\xD6\xD8-\xF6\xF8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u{10000}-\u{EFFFF}";
    exports.NC_NAME_CHAR = "-" + exports.NC_NAME_START_CHAR + ".0-9\xB7\u0300-\u036F\u203F-\u2040";
    exports.NC_NAME_START_CHAR_RE = new RegExp("^[" + exports.NC_NAME_START_CHAR + "]$", "u");
    exports.NC_NAME_CHAR_RE = new RegExp("^[" + exports.NC_NAME_CHAR + "]$", "u");
    exports.NC_NAME_RE = new RegExp("^[" + exports.NC_NAME_START_CHAR + "][" + exports.NC_NAME_CHAR + "]*$", "u");
    function isNCNameStartChar(c) {
      return c >= 65 && c <= 90 || c === 95 || c >= 97 && c <= 122 || c >= 192 && c <= 214 || c >= 216 && c <= 246 || c >= 248 && c <= 767 || c >= 880 && c <= 893 || c >= 895 && c <= 8191 || c >= 8204 && c <= 8205 || c >= 8304 && c <= 8591 || c >= 11264 && c <= 12271 || c >= 12289 && c <= 55295 || c >= 63744 && c <= 64975 || c >= 65008 && c <= 65533 || c >= 65536 && c <= 983039;
    }
    exports.isNCNameStartChar = isNCNameStartChar;
    function isNCNameChar(c) {
      return isNCNameStartChar(c) || (c === 45 || c === 46 || c >= 48 && c <= 57 || c === 183 || c >= 768 && c <= 879 || c >= 8255 && c <= 8256);
    }
    exports.isNCNameChar = isNCNameChar;
  }
});

// node_modules/saxes/saxes.js
var require_saxes = __commonJS({
  "node_modules/saxes/saxes.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.SaxesParser = exports.EVENTS = void 0;
    var ed5 = require_ed5();
    var ed2 = require_ed2();
    var NSed3 = require_ed3();
    var isS = ed5.isS;
    var isChar10 = ed5.isChar;
    var isNameStartChar = ed5.isNameStartChar;
    var isNameChar = ed5.isNameChar;
    var S_LIST = ed5.S_LIST;
    var NAME_RE = ed5.NAME_RE;
    var isChar11 = ed2.isChar;
    var isNCNameStartChar = NSed3.isNCNameStartChar;
    var isNCNameChar = NSed3.isNCNameChar;
    var NC_NAME_RE = NSed3.NC_NAME_RE;
    var XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
    var XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";
    var rootNS = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      __proto__: null,
      xml: XML_NAMESPACE,
      xmlns: XMLNS_NAMESPACE
    };
    var XML_ENTITIES = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      __proto__: null,
      amp: "&",
      gt: ">",
      lt: "<",
      quot: '"',
      apos: "'"
    };
    var EOC = -1;
    var NL_LIKE = -2;
    var S_BEGIN = 0;
    var S_BEGIN_WHITESPACE = 1;
    var S_DOCTYPE = 2;
    var S_DOCTYPE_QUOTE = 3;
    var S_DTD = 4;
    var S_DTD_QUOTED = 5;
    var S_DTD_OPEN_WAKA = 6;
    var S_DTD_OPEN_WAKA_BANG = 7;
    var S_DTD_COMMENT = 8;
    var S_DTD_COMMENT_ENDING = 9;
    var S_DTD_COMMENT_ENDED = 10;
    var S_DTD_PI = 11;
    var S_DTD_PI_ENDING = 12;
    var S_TEXT = 13;
    var S_ENTITY = 14;
    var S_OPEN_WAKA = 15;
    var S_OPEN_WAKA_BANG = 16;
    var S_COMMENT = 17;
    var S_COMMENT_ENDING = 18;
    var S_COMMENT_ENDED = 19;
    var S_CDATA = 20;
    var S_CDATA_ENDING = 21;
    var S_CDATA_ENDING_2 = 22;
    var S_PI_FIRST_CHAR = 23;
    var S_PI_REST = 24;
    var S_PI_BODY = 25;
    var S_PI_ENDING = 26;
    var S_XML_DECL_NAME_START = 27;
    var S_XML_DECL_NAME = 28;
    var S_XML_DECL_EQ = 29;
    var S_XML_DECL_VALUE_START = 30;
    var S_XML_DECL_VALUE = 31;
    var S_XML_DECL_SEPARATOR = 32;
    var S_XML_DECL_ENDING = 33;
    var S_OPEN_TAG = 34;
    var S_OPEN_TAG_SLASH = 35;
    var S_ATTRIB = 36;
    var S_ATTRIB_NAME = 37;
    var S_ATTRIB_NAME_SAW_WHITE = 38;
    var S_ATTRIB_VALUE = 39;
    var S_ATTRIB_VALUE_QUOTED = 40;
    var S_ATTRIB_VALUE_CLOSED = 41;
    var S_ATTRIB_VALUE_UNQUOTED = 42;
    var S_CLOSE_TAG = 43;
    var S_CLOSE_TAG_SAW_WHITE = 44;
    var TAB = 9;
    var NL = 10;
    var CR = 13;
    var SPACE = 32;
    var BANG = 33;
    var DQUOTE = 34;
    var AMP = 38;
    var SQUOTE = 39;
    var MINUS = 45;
    var FORWARD_SLASH = 47;
    var SEMICOLON = 59;
    var LESS = 60;
    var EQUAL = 61;
    var GREATER = 62;
    var QUESTION = 63;
    var OPEN_BRACKET = 91;
    var CLOSE_BRACKET = 93;
    var NEL = 133;
    var LS = 8232;
    var isQuote = (c) => c === DQUOTE || c === SQUOTE;
    var QUOTES = [DQUOTE, SQUOTE];
    var DOCTYPE_TERMINATOR = [...QUOTES, OPEN_BRACKET, GREATER];
    var DTD_TERMINATOR = [...QUOTES, LESS, CLOSE_BRACKET];
    var XML_DECL_NAME_TERMINATOR = [EQUAL, QUESTION, ...S_LIST];
    var ATTRIB_VALUE_UNQUOTED_TERMINATOR = [...S_LIST, GREATER, AMP, LESS];
    function nsPairCheck(parser, prefix, uri) {
      switch (prefix) {
        case "xml":
          if (uri !== XML_NAMESPACE) {
            parser.fail(`xml prefix must be bound to ${XML_NAMESPACE}.`);
          }
          break;
        case "xmlns":
          if (uri !== XMLNS_NAMESPACE) {
            parser.fail(`xmlns prefix must be bound to ${XMLNS_NAMESPACE}.`);
          }
          break;
        default:
      }
      switch (uri) {
        case XMLNS_NAMESPACE:
          parser.fail(prefix === "" ? `the default namespace may not be set to ${uri}.` : `may not assign a prefix (even "xmlns") to the URI ${XMLNS_NAMESPACE}.`);
          break;
        case XML_NAMESPACE:
          switch (prefix) {
            case "xml":
              break;
            case "":
              parser.fail(`the default namespace may not be set to ${uri}.`);
              break;
            default:
              parser.fail("may not assign the xml namespace to another prefix.");
          }
          break;
        default:
      }
    }
    function nsMappingCheck(parser, mapping) {
      for (const local of Object.keys(mapping)) {
        nsPairCheck(parser, local, mapping[local]);
      }
    }
    var isNCName = (name) => NC_NAME_RE.test(name);
    var isName = (name) => NAME_RE.test(name);
    var FORBIDDEN_START = 0;
    var FORBIDDEN_BRACKET = 1;
    var FORBIDDEN_BRACKET_BRACKET = 2;
    exports.EVENTS = [
      "xmldecl",
      "text",
      "processinginstruction",
      "doctype",
      "comment",
      "opentagstart",
      "attribute",
      "opentag",
      "closetag",
      "cdata",
      "error",
      "end",
      "ready"
    ];
    var EVENT_NAME_TO_HANDLER_NAME = {
      xmldecl: "xmldeclHandler",
      text: "textHandler",
      processinginstruction: "piHandler",
      doctype: "doctypeHandler",
      comment: "commentHandler",
      opentagstart: "openTagStartHandler",
      attribute: "attributeHandler",
      opentag: "openTagHandler",
      closetag: "closeTagHandler",
      cdata: "cdataHandler",
      error: "errorHandler",
      end: "endHandler",
      ready: "readyHandler"
    };
    var SaxesParser2 = class {
      /**
       * @param opt The parser options.
       */
      constructor(opt) {
        this.opt = opt !== null && opt !== void 0 ? opt : {};
        this.fragmentOpt = !!this.opt.fragment;
        const xmlnsOpt = this.xmlnsOpt = !!this.opt.xmlns;
        this.trackPosition = this.opt.position !== false;
        this.fileName = this.opt.fileName;
        if (xmlnsOpt) {
          this.nameStartCheck = isNCNameStartChar;
          this.nameCheck = isNCNameChar;
          this.isName = isNCName;
          this.processAttribs = this.processAttribsNS;
          this.pushAttrib = this.pushAttribNS;
          this.ns = Object.assign({ __proto__: null }, rootNS);
          const additional = this.opt.additionalNamespaces;
          if (additional != null) {
            nsMappingCheck(this, additional);
            Object.assign(this.ns, additional);
          }
        } else {
          this.nameStartCheck = isNameStartChar;
          this.nameCheck = isNameChar;
          this.isName = isName;
          this.processAttribs = this.processAttribsPlain;
          this.pushAttrib = this.pushAttribPlain;
        }
        this.stateTable = [
          /* eslint-disable @typescript-eslint/unbound-method */
          this.sBegin,
          this.sBeginWhitespace,
          this.sDoctype,
          this.sDoctypeQuote,
          this.sDTD,
          this.sDTDQuoted,
          this.sDTDOpenWaka,
          this.sDTDOpenWakaBang,
          this.sDTDComment,
          this.sDTDCommentEnding,
          this.sDTDCommentEnded,
          this.sDTDPI,
          this.sDTDPIEnding,
          this.sText,
          this.sEntity,
          this.sOpenWaka,
          this.sOpenWakaBang,
          this.sComment,
          this.sCommentEnding,
          this.sCommentEnded,
          this.sCData,
          this.sCDataEnding,
          this.sCDataEnding2,
          this.sPIFirstChar,
          this.sPIRest,
          this.sPIBody,
          this.sPIEnding,
          this.sXMLDeclNameStart,
          this.sXMLDeclName,
          this.sXMLDeclEq,
          this.sXMLDeclValueStart,
          this.sXMLDeclValue,
          this.sXMLDeclSeparator,
          this.sXMLDeclEnding,
          this.sOpenTag,
          this.sOpenTagSlash,
          this.sAttrib,
          this.sAttribName,
          this.sAttribNameSawWhite,
          this.sAttribValue,
          this.sAttribValueQuoted,
          this.sAttribValueClosed,
          this.sAttribValueUnquoted,
          this.sCloseTag,
          this.sCloseTagSawWhite
          /* eslint-enable @typescript-eslint/unbound-method */
        ];
        this._init();
      }
      /**
       * Indicates whether or not the parser is closed. If ``true``, wait for
       * the ``ready`` event to write again.
       */
      get closed() {
        return this._closed;
      }
      _init() {
        var _a;
        this.openWakaBang = "";
        this.text = "";
        this.name = "";
        this.piTarget = "";
        this.entity = "";
        this.q = null;
        this.tags = [];
        this.tag = null;
        this.topNS = null;
        this.chunk = "";
        this.chunkPosition = 0;
        this.i = 0;
        this.prevI = 0;
        this.carriedFromPrevious = void 0;
        this.forbiddenState = FORBIDDEN_START;
        this.attribList = [];
        const { fragmentOpt } = this;
        this.state = fragmentOpt ? S_TEXT : S_BEGIN;
        this.reportedTextBeforeRoot = this.reportedTextAfterRoot = this.closedRoot = this.sawRoot = fragmentOpt;
        this.xmlDeclPossible = !fragmentOpt;
        this.xmlDeclExpects = ["version"];
        this.entityReturnState = void 0;
        let { defaultXMLVersion } = this.opt;
        if (defaultXMLVersion === void 0) {
          if (this.opt.forceXMLVersion === true) {
            throw new Error("forceXMLVersion set but defaultXMLVersion is not set");
          }
          defaultXMLVersion = "1.0";
        }
        this.setXMLVersion(defaultXMLVersion);
        this.positionAtNewLine = 0;
        this.doctype = false;
        this._closed = false;
        this.xmlDecl = {
          version: void 0,
          encoding: void 0,
          standalone: void 0
        };
        this.line = 1;
        this.column = 0;
        this.ENTITIES = Object.create(XML_ENTITIES);
        (_a = this.readyHandler) === null || _a === void 0 ? void 0 : _a.call(this);
      }
      /**
       * The stream position the parser is currently looking at. This field is
       * zero-based.
       *
       * This field is not based on counting Unicode characters but is to be
       * interpreted as a plain index into a JavaScript string.
       */
      get position() {
        return this.chunkPosition + this.i;
      }
      /**
       * The column number of the next character to be read by the parser.  *
       * This field is zero-based. (The first column in a line is 0.)
       *
       * This field reports the index at which the next character would be in the
       * line if the line were represented as a JavaScript string.  Note that this
       * *can* be different to a count based on the number of *Unicode characters*
       * due to how JavaScript handles astral plane characters.
       *
       * See [[column]] for a number that corresponds to a count of Unicode
       * characters.
       */
      get columnIndex() {
        return this.position - this.positionAtNewLine;
      }
      /**
       * Set an event listener on an event. The parser supports one handler per
       * event type. If you try to set an event handler over an existing handler,
       * the old handler is silently overwritten.
       *
       * @param name The event to listen to.
       *
       * @param handler The handler to set.
       */
      on(name, handler) {
        this[EVENT_NAME_TO_HANDLER_NAME[name]] = handler;
      }
      /**
       * Unset an event handler.
       *
       * @parma name The event to stop listening to.
       */
      off(name) {
        this[EVENT_NAME_TO_HANDLER_NAME[name]] = void 0;
      }
      /**
       * Make an error object. The error object will have a message that contains
       * the ``fileName`` option passed at the creation of the parser. If position
       * tracking was turned on, it will also have line and column number
       * information.
       *
       * @param message The message describing the error to report.
       *
       * @returns An error object with a properly formatted message.
       */
      makeError(message) {
        var _a;
        let msg = (_a = this.fileName) !== null && _a !== void 0 ? _a : "";
        if (this.trackPosition) {
          if (msg.length > 0) {
            msg += ":";
          }
          msg += `${this.line}:${this.column}`;
        }
        if (msg.length > 0) {
          msg += ": ";
        }
        return new Error(msg + message);
      }
      /**
       * Report a parsing error. This method is made public so that client code may
       * check for issues that are outside the scope of this project and can report
       * errors.
       *
       * @param message The error to report.
       *
       * @returns this
       */
      fail(message) {
        const err = this.makeError(message);
        const handler = this.errorHandler;
        if (handler === void 0) {
          throw err;
        } else {
          handler(err);
        }
        return this;
      }
      /**
       * Write a XML data to the parser.
       *
       * @param chunk The XML data to write.
       *
       * @returns this
       */
      // We do need object for the type here. Yes, it often causes problems
      // but not in this case.
      write(chunk) {
        if (this.closed) {
          return this.fail("cannot write after close; assign an onready handler.");
        }
        let end = false;
        if (chunk === null) {
          end = true;
          chunk = "";
        } else if (typeof chunk === "object") {
          chunk = chunk.toString();
        }
        if (this.carriedFromPrevious !== void 0) {
          chunk = `${this.carriedFromPrevious}${chunk}`;
          this.carriedFromPrevious = void 0;
        }
        let limit = chunk.length;
        const lastCode = chunk.charCodeAt(limit - 1);
        if (!end && // A trailing CR or surrogate must be carried over to the next
        // chunk.
        (lastCode === CR || lastCode >= 55296 && lastCode <= 56319)) {
          this.carriedFromPrevious = chunk[limit - 1];
          limit--;
          chunk = chunk.slice(0, limit);
        }
        const { stateTable } = this;
        this.chunk = chunk;
        this.i = 0;
        while (this.i < limit) {
          stateTable[this.state].call(this);
        }
        this.chunkPosition += limit;
        return end ? this.end() : this;
      }
      /**
       * Close the current stream. Perform final well-formedness checks and reset
       * the parser tstate.
       *
       * @returns this
       */
      close() {
        return this.write(null);
      }
      /**
       * Get a single code point out of the current chunk. This updates the current
       * position if we do position tracking.
       *
       * This is the algorithm to use for XML 1.0.
       *
       * @returns The character read.
       */
      getCode10() {
        const { chunk, i } = this;
        this.prevI = i;
        this.i = i + 1;
        if (i >= chunk.length) {
          return EOC;
        }
        const code = chunk.charCodeAt(i);
        this.column++;
        if (code < 55296) {
          if (code >= SPACE || code === TAB) {
            return code;
          }
          switch (code) {
            case NL:
              this.line++;
              this.column = 0;
              this.positionAtNewLine = this.position;
              return NL;
            case CR:
              if (chunk.charCodeAt(i + 1) === NL) {
                this.i = i + 2;
              }
              this.line++;
              this.column = 0;
              this.positionAtNewLine = this.position;
              return NL_LIKE;
            default:
              this.fail("disallowed character.");
              return code;
          }
        }
        if (code > 56319) {
          if (!(code >= 57344 && code <= 65533)) {
            this.fail("disallowed character.");
          }
          return code;
        }
        const final = 65536 + (code - 55296) * 1024 + (chunk.charCodeAt(i + 1) - 56320);
        this.i = i + 2;
        if (final > 1114111) {
          this.fail("disallowed character.");
        }
        return final;
      }
      /**
       * Get a single code point out of the current chunk. This updates the current
       * position if we do position tracking.
       *
       * This is the algorithm to use for XML 1.1.
       *
       * @returns {number} The character read.
       */
      getCode11() {
        const { chunk, i } = this;
        this.prevI = i;
        this.i = i + 1;
        if (i >= chunk.length) {
          return EOC;
        }
        const code = chunk.charCodeAt(i);
        this.column++;
        if (code < 55296) {
          if (code > 31 && code < 127 || code > 159 && code !== LS || code === TAB) {
            return code;
          }
          switch (code) {
            case NL:
              this.line++;
              this.column = 0;
              this.positionAtNewLine = this.position;
              return NL;
            case CR: {
              const next = chunk.charCodeAt(i + 1);
              if (next === NL || next === NEL) {
                this.i = i + 2;
              }
            }
            /* yes, fall through */
            case NEL:
            // 0x85
            case LS:
              this.line++;
              this.column = 0;
              this.positionAtNewLine = this.position;
              return NL_LIKE;
            default:
              this.fail("disallowed character.");
              return code;
          }
        }
        if (code > 56319) {
          if (!(code >= 57344 && code <= 65533)) {
            this.fail("disallowed character.");
          }
          return code;
        }
        const final = 65536 + (code - 55296) * 1024 + (chunk.charCodeAt(i + 1) - 56320);
        this.i = i + 2;
        if (final > 1114111) {
          this.fail("disallowed character.");
        }
        return final;
      }
      /**
       * Like ``getCode`` but with the return value normalized so that ``NL`` is
       * returned for ``NL_LIKE``.
       */
      getCodeNorm() {
        const c = this.getCode();
        return c === NL_LIKE ? NL : c;
      }
      unget() {
        this.i = this.prevI;
        this.column--;
      }
      /**
       * Capture characters into a buffer until encountering one of a set of
       * characters.
       *
       * @param chars An array of codepoints. Encountering a character in the array
       * ends the capture. (``chars`` may safely contain ``NL``.)
       *
       * @return The character code that made the capture end, or ``EOC`` if we hit
       * the end of the chunk. The return value cannot be NL_LIKE: NL is returned
       * instead.
       */
      captureTo(chars) {
        let { i: start } = this;
        const { chunk } = this;
        while (true) {
          const c = this.getCode();
          const isNLLike = c === NL_LIKE;
          const final = isNLLike ? NL : c;
          if (final === EOC || chars.includes(final)) {
            this.text += chunk.slice(start, this.prevI);
            return final;
          }
          if (isNLLike) {
            this.text += `${chunk.slice(start, this.prevI)}
`;
            start = this.i;
          }
        }
      }
      /**
       * Capture characters into a buffer until encountering a character.
       *
       * @param char The codepoint that ends the capture. **NOTE ``char`` MAY NOT
       * CONTAIN ``NL``.** Passing ``NL`` will result in buggy behavior.
       *
       * @return ``true`` if we ran into the character. Otherwise, we ran into the
       * end of the current chunk.
       */
      captureToChar(char) {
        let { i: start } = this;
        const { chunk } = this;
        while (true) {
          let c = this.getCode();
          switch (c) {
            case NL_LIKE:
              this.text += `${chunk.slice(start, this.prevI)}
`;
              start = this.i;
              c = NL;
              break;
            case EOC:
              this.text += chunk.slice(start);
              return false;
            default:
          }
          if (c === char) {
            this.text += chunk.slice(start, this.prevI);
            return true;
          }
        }
      }
      /**
       * Capture characters that satisfy ``isNameChar`` into the ``name`` field of
       * this parser.
       *
       * @return The character code that made the test fail, or ``EOC`` if we hit
       * the end of the chunk. The return value cannot be NL_LIKE: NL is returned
       * instead.
       */
      captureNameChars() {
        const { chunk, i: start } = this;
        while (true) {
          const c = this.getCode();
          if (c === EOC) {
            this.name += chunk.slice(start);
            return EOC;
          }
          if (!isNameChar(c)) {
            this.name += chunk.slice(start, this.prevI);
            return c === NL_LIKE ? NL : c;
          }
        }
      }
      /**
       * Skip white spaces.
       *
       * @return The character that ended the skip, or ``EOC`` if we hit
       * the end of the chunk. The return value cannot be NL_LIKE: NL is returned
       * instead.
       */
      skipSpaces() {
        while (true) {
          const c = this.getCodeNorm();
          if (c === EOC || !isS(c)) {
            return c;
          }
        }
      }
      setXMLVersion(version) {
        this.currentXMLVersion = version;
        if (version === "1.0") {
          this.isChar = isChar10;
          this.getCode = this.getCode10;
        } else {
          this.isChar = isChar11;
          this.getCode = this.getCode11;
        }
      }
      // STATE ENGINE METHODS
      // This needs to be a state separate from S_BEGIN_WHITESPACE because we want
      // to be sure never to come back to this state later.
      sBegin() {
        if (this.chunk.charCodeAt(0) === 65279) {
          this.i++;
          this.column++;
        }
        this.state = S_BEGIN_WHITESPACE;
      }
      sBeginWhitespace() {
        const iBefore = this.i;
        const c = this.skipSpaces();
        if (this.prevI !== iBefore) {
          this.xmlDeclPossible = false;
        }
        switch (c) {
          case LESS:
            this.state = S_OPEN_WAKA;
            if (this.text.length !== 0) {
              throw new Error("no-empty text at start");
            }
            break;
          case EOC:
            break;
          default:
            this.unget();
            this.state = S_TEXT;
            this.xmlDeclPossible = false;
        }
      }
      sDoctype() {
        var _a;
        const c = this.captureTo(DOCTYPE_TERMINATOR);
        switch (c) {
          case GREATER: {
            (_a = this.doctypeHandler) === null || _a === void 0 ? void 0 : _a.call(this, this.text);
            this.text = "";
            this.state = S_TEXT;
            this.doctype = true;
            break;
          }
          case EOC:
            break;
          default:
            this.text += String.fromCodePoint(c);
            if (c === OPEN_BRACKET) {
              this.state = S_DTD;
            } else if (isQuote(c)) {
              this.state = S_DOCTYPE_QUOTE;
              this.q = c;
            }
        }
      }
      sDoctypeQuote() {
        const q = this.q;
        if (this.captureToChar(q)) {
          this.text += String.fromCodePoint(q);
          this.q = null;
          this.state = S_DOCTYPE;
        }
      }
      sDTD() {
        const c = this.captureTo(DTD_TERMINATOR);
        if (c === EOC) {
          return;
        }
        this.text += String.fromCodePoint(c);
        if (c === CLOSE_BRACKET) {
          this.state = S_DOCTYPE;
        } else if (c === LESS) {
          this.state = S_DTD_OPEN_WAKA;
        } else if (isQuote(c)) {
          this.state = S_DTD_QUOTED;
          this.q = c;
        }
      }
      sDTDQuoted() {
        const q = this.q;
        if (this.captureToChar(q)) {
          this.text += String.fromCodePoint(q);
          this.state = S_DTD;
          this.q = null;
        }
      }
      sDTDOpenWaka() {
        const c = this.getCodeNorm();
        this.text += String.fromCodePoint(c);
        switch (c) {
          case BANG:
            this.state = S_DTD_OPEN_WAKA_BANG;
            this.openWakaBang = "";
            break;
          case QUESTION:
            this.state = S_DTD_PI;
            break;
          default:
            this.state = S_DTD;
        }
      }
      sDTDOpenWakaBang() {
        const char = String.fromCodePoint(this.getCodeNorm());
        const owb = this.openWakaBang += char;
        this.text += char;
        if (owb !== "-") {
          this.state = owb === "--" ? S_DTD_COMMENT : S_DTD;
          this.openWakaBang = "";
        }
      }
      sDTDComment() {
        if (this.captureToChar(MINUS)) {
          this.text += "-";
          this.state = S_DTD_COMMENT_ENDING;
        }
      }
      sDTDCommentEnding() {
        const c = this.getCodeNorm();
        this.text += String.fromCodePoint(c);
        this.state = c === MINUS ? S_DTD_COMMENT_ENDED : S_DTD_COMMENT;
      }
      sDTDCommentEnded() {
        const c = this.getCodeNorm();
        this.text += String.fromCodePoint(c);
        if (c === GREATER) {
          this.state = S_DTD;
        } else {
          this.fail("malformed comment.");
          this.state = S_DTD_COMMENT;
        }
      }
      sDTDPI() {
        if (this.captureToChar(QUESTION)) {
          this.text += "?";
          this.state = S_DTD_PI_ENDING;
        }
      }
      sDTDPIEnding() {
        const c = this.getCodeNorm();
        this.text += String.fromCodePoint(c);
        if (c === GREATER) {
          this.state = S_DTD;
        }
      }
      sText() {
        if (this.tags.length !== 0) {
          this.handleTextInRoot();
        } else {
          this.handleTextOutsideRoot();
        }
      }
      sEntity() {
        let { i: start } = this;
        const { chunk } = this;
        loop:
          while (true) {
            switch (this.getCode()) {
              case NL_LIKE:
                this.entity += `${chunk.slice(start, this.prevI)}
`;
                start = this.i;
                break;
              case SEMICOLON: {
                const { entityReturnState } = this;
                const entity = this.entity + chunk.slice(start, this.prevI);
                this.state = entityReturnState;
                let parsed;
                if (entity === "") {
                  this.fail("empty entity name.");
                  parsed = "&;";
                } else {
                  parsed = this.parseEntity(entity);
                  this.entity = "";
                }
                if (entityReturnState !== S_TEXT || this.textHandler !== void 0) {
                  this.text += parsed;
                }
                break loop;
              }
              case EOC:
                this.entity += chunk.slice(start);
                break loop;
              default:
            }
          }
      }
      sOpenWaka() {
        const c = this.getCode();
        if (isNameStartChar(c)) {
          this.state = S_OPEN_TAG;
          this.unget();
          this.xmlDeclPossible = false;
        } else {
          switch (c) {
            case FORWARD_SLASH:
              this.state = S_CLOSE_TAG;
              this.xmlDeclPossible = false;
              break;
            case BANG:
              this.state = S_OPEN_WAKA_BANG;
              this.openWakaBang = "";
              this.xmlDeclPossible = false;
              break;
            case QUESTION:
              this.state = S_PI_FIRST_CHAR;
              break;
            default:
              this.fail("disallowed character in tag name");
              this.state = S_TEXT;
              this.xmlDeclPossible = false;
          }
        }
      }
      sOpenWakaBang() {
        this.openWakaBang += String.fromCodePoint(this.getCodeNorm());
        switch (this.openWakaBang) {
          case "[CDATA[":
            if (!this.sawRoot && !this.reportedTextBeforeRoot) {
              this.fail("text data outside of root node.");
              this.reportedTextBeforeRoot = true;
            }
            if (this.closedRoot && !this.reportedTextAfterRoot) {
              this.fail("text data outside of root node.");
              this.reportedTextAfterRoot = true;
            }
            this.state = S_CDATA;
            this.openWakaBang = "";
            break;
          case "--":
            this.state = S_COMMENT;
            this.openWakaBang = "";
            break;
          case "DOCTYPE":
            this.state = S_DOCTYPE;
            if (this.doctype || this.sawRoot) {
              this.fail("inappropriately located doctype declaration.");
            }
            this.openWakaBang = "";
            break;
          default:
            if (this.openWakaBang.length >= 7) {
              this.fail("incorrect syntax.");
            }
        }
      }
      sComment() {
        if (this.captureToChar(MINUS)) {
          this.state = S_COMMENT_ENDING;
        }
      }
      sCommentEnding() {
        var _a;
        const c = this.getCodeNorm();
        if (c === MINUS) {
          this.state = S_COMMENT_ENDED;
          (_a = this.commentHandler) === null || _a === void 0 ? void 0 : _a.call(this, this.text);
          this.text = "";
        } else {
          this.text += `-${String.fromCodePoint(c)}`;
          this.state = S_COMMENT;
        }
      }
      sCommentEnded() {
        const c = this.getCodeNorm();
        if (c !== GREATER) {
          this.fail("malformed comment.");
          this.text += `--${String.fromCodePoint(c)}`;
          this.state = S_COMMENT;
        } else {
          this.state = S_TEXT;
        }
      }
      sCData() {
        if (this.captureToChar(CLOSE_BRACKET)) {
          this.state = S_CDATA_ENDING;
        }
      }
      sCDataEnding() {
        const c = this.getCodeNorm();
        if (c === CLOSE_BRACKET) {
          this.state = S_CDATA_ENDING_2;
        } else {
          this.text += `]${String.fromCodePoint(c)}`;
          this.state = S_CDATA;
        }
      }
      sCDataEnding2() {
        var _a;
        const c = this.getCodeNorm();
        switch (c) {
          case GREATER: {
            (_a = this.cdataHandler) === null || _a === void 0 ? void 0 : _a.call(this, this.text);
            this.text = "";
            this.state = S_TEXT;
            break;
          }
          case CLOSE_BRACKET:
            this.text += "]";
            break;
          default:
            this.text += `]]${String.fromCodePoint(c)}`;
            this.state = S_CDATA;
        }
      }
      // We need this separate state to check the first character fo the pi target
      // with this.nameStartCheck which allows less characters than this.nameCheck.
      sPIFirstChar() {
        const c = this.getCodeNorm();
        if (this.nameStartCheck(c)) {
          this.piTarget += String.fromCodePoint(c);
          this.state = S_PI_REST;
        } else if (c === QUESTION || isS(c)) {
          this.fail("processing instruction without a target.");
          this.state = c === QUESTION ? S_PI_ENDING : S_PI_BODY;
        } else {
          this.fail("disallowed character in processing instruction name.");
          this.piTarget += String.fromCodePoint(c);
          this.state = S_PI_REST;
        }
      }
      sPIRest() {
        const { chunk, i: start } = this;
        while (true) {
          const c = this.getCodeNorm();
          if (c === EOC) {
            this.piTarget += chunk.slice(start);
            return;
          }
          if (!this.nameCheck(c)) {
            this.piTarget += chunk.slice(start, this.prevI);
            const isQuestion = c === QUESTION;
            if (isQuestion || isS(c)) {
              if (this.piTarget === "xml") {
                if (!this.xmlDeclPossible) {
                  this.fail("an XML declaration must be at the start of the document.");
                }
                this.state = isQuestion ? S_XML_DECL_ENDING : S_XML_DECL_NAME_START;
              } else {
                this.state = isQuestion ? S_PI_ENDING : S_PI_BODY;
              }
            } else {
              this.fail("disallowed character in processing instruction name.");
              this.piTarget += String.fromCodePoint(c);
            }
            break;
          }
        }
      }
      sPIBody() {
        if (this.text.length === 0) {
          const c = this.getCodeNorm();
          if (c === QUESTION) {
            this.state = S_PI_ENDING;
          } else if (!isS(c)) {
            this.text = String.fromCodePoint(c);
          }
        } else if (this.captureToChar(QUESTION)) {
          this.state = S_PI_ENDING;
        }
      }
      sPIEnding() {
        var _a;
        const c = this.getCodeNorm();
        if (c === GREATER) {
          const { piTarget } = this;
          if (piTarget.toLowerCase() === "xml") {
            this.fail("the XML declaration must appear at the start of the document.");
          }
          (_a = this.piHandler) === null || _a === void 0 ? void 0 : _a.call(this, {
            target: piTarget,
            body: this.text
          });
          this.piTarget = this.text = "";
          this.state = S_TEXT;
        } else if (c === QUESTION) {
          this.text += "?";
        } else {
          this.text += `?${String.fromCodePoint(c)}`;
          this.state = S_PI_BODY;
        }
        this.xmlDeclPossible = false;
      }
      sXMLDeclNameStart() {
        const c = this.skipSpaces();
        if (c === QUESTION) {
          this.state = S_XML_DECL_ENDING;
          return;
        }
        if (c !== EOC) {
          this.state = S_XML_DECL_NAME;
          this.name = String.fromCodePoint(c);
        }
      }
      sXMLDeclName() {
        const c = this.captureTo(XML_DECL_NAME_TERMINATOR);
        if (c === QUESTION) {
          this.state = S_XML_DECL_ENDING;
          this.name += this.text;
          this.text = "";
          this.fail("XML declaration is incomplete.");
          return;
        }
        if (!(isS(c) || c === EQUAL)) {
          return;
        }
        this.name += this.text;
        this.text = "";
        if (!this.xmlDeclExpects.includes(this.name)) {
          switch (this.name.length) {
            case 0:
              this.fail("did not expect any more name/value pairs.");
              break;
            case 1:
              this.fail(`expected the name ${this.xmlDeclExpects[0]}.`);
              break;
            default:
              this.fail(`expected one of ${this.xmlDeclExpects.join(", ")}`);
          }
        }
        this.state = c === EQUAL ? S_XML_DECL_VALUE_START : S_XML_DECL_EQ;
      }
      sXMLDeclEq() {
        const c = this.getCodeNorm();
        if (c === QUESTION) {
          this.state = S_XML_DECL_ENDING;
          this.fail("XML declaration is incomplete.");
          return;
        }
        if (isS(c)) {
          return;
        }
        if (c !== EQUAL) {
          this.fail("value required.");
        }
        this.state = S_XML_DECL_VALUE_START;
      }
      sXMLDeclValueStart() {
        const c = this.getCodeNorm();
        if (c === QUESTION) {
          this.state = S_XML_DECL_ENDING;
          this.fail("XML declaration is incomplete.");
          return;
        }
        if (isS(c)) {
          return;
        }
        if (!isQuote(c)) {
          this.fail("value must be quoted.");
          this.q = SPACE;
        } else {
          this.q = c;
        }
        this.state = S_XML_DECL_VALUE;
      }
      sXMLDeclValue() {
        const c = this.captureTo([this.q, QUESTION]);
        if (c === QUESTION) {
          this.state = S_XML_DECL_ENDING;
          this.text = "";
          this.fail("XML declaration is incomplete.");
          return;
        }
        if (c === EOC) {
          return;
        }
        const value = this.text;
        this.text = "";
        switch (this.name) {
          case "version": {
            this.xmlDeclExpects = ["encoding", "standalone"];
            const version = value;
            this.xmlDecl.version = version;
            if (!/^1\.[0-9]+$/.test(version)) {
              this.fail("version number must match /^1\\.[0-9]+$/.");
            } else if (!this.opt.forceXMLVersion) {
              this.setXMLVersion(version);
            }
            break;
          }
          case "encoding":
            if (!/^[A-Za-z][A-Za-z0-9._-]*$/.test(value)) {
              this.fail("encoding value must match /^[A-Za-z0-9][A-Za-z0-9._-]*$/.");
            }
            this.xmlDeclExpects = ["standalone"];
            this.xmlDecl.encoding = value;
            break;
          case "standalone":
            if (value !== "yes" && value !== "no") {
              this.fail('standalone value must match "yes" or "no".');
            }
            this.xmlDeclExpects = [];
            this.xmlDecl.standalone = value;
            break;
          default:
        }
        this.name = "";
        this.state = S_XML_DECL_SEPARATOR;
      }
      sXMLDeclSeparator() {
        const c = this.getCodeNorm();
        if (c === QUESTION) {
          this.state = S_XML_DECL_ENDING;
          return;
        }
        if (!isS(c)) {
          this.fail("whitespace required.");
          this.unget();
        }
        this.state = S_XML_DECL_NAME_START;
      }
      sXMLDeclEnding() {
        var _a;
        const c = this.getCodeNorm();
        if (c === GREATER) {
          if (this.piTarget !== "xml") {
            this.fail("processing instructions are not allowed before root.");
          } else if (this.name !== "version" && this.xmlDeclExpects.includes("version")) {
            this.fail("XML declaration must contain a version.");
          }
          (_a = this.xmldeclHandler) === null || _a === void 0 ? void 0 : _a.call(this, this.xmlDecl);
          this.name = "";
          this.piTarget = this.text = "";
          this.state = S_TEXT;
        } else {
          this.fail("The character ? is disallowed anywhere in XML declarations.");
        }
        this.xmlDeclPossible = false;
      }
      sOpenTag() {
        var _a;
        const c = this.captureNameChars();
        if (c === EOC) {
          return;
        }
        const tag = this.tag = {
          name: this.name,
          attributes: /* @__PURE__ */ Object.create(null)
        };
        this.name = "";
        if (this.xmlnsOpt) {
          this.topNS = tag.ns = /* @__PURE__ */ Object.create(null);
        }
        (_a = this.openTagStartHandler) === null || _a === void 0 ? void 0 : _a.call(this, tag);
        this.sawRoot = true;
        if (!this.fragmentOpt && this.closedRoot) {
          this.fail("documents may contain only one root.");
        }
        switch (c) {
          case GREATER:
            this.openTag();
            break;
          case FORWARD_SLASH:
            this.state = S_OPEN_TAG_SLASH;
            break;
          default:
            if (!isS(c)) {
              this.fail("disallowed character in tag name.");
            }
            this.state = S_ATTRIB;
        }
      }
      sOpenTagSlash() {
        if (this.getCode() === GREATER) {
          this.openSelfClosingTag();
        } else {
          this.fail("forward-slash in opening tag not followed by >.");
          this.state = S_ATTRIB;
        }
      }
      sAttrib() {
        const c = this.skipSpaces();
        if (c === EOC) {
          return;
        }
        if (isNameStartChar(c)) {
          this.unget();
          this.state = S_ATTRIB_NAME;
        } else if (c === GREATER) {
          this.openTag();
        } else if (c === FORWARD_SLASH) {
          this.state = S_OPEN_TAG_SLASH;
        } else {
          this.fail("disallowed character in attribute name.");
        }
      }
      sAttribName() {
        const c = this.captureNameChars();
        if (c === EQUAL) {
          this.state = S_ATTRIB_VALUE;
        } else if (isS(c)) {
          this.state = S_ATTRIB_NAME_SAW_WHITE;
        } else if (c === GREATER) {
          this.fail("attribute without value.");
          this.pushAttrib(this.name, this.name);
          this.name = this.text = "";
          this.openTag();
        } else if (c !== EOC) {
          this.fail("disallowed character in attribute name.");
        }
      }
      sAttribNameSawWhite() {
        const c = this.skipSpaces();
        switch (c) {
          case EOC:
            return;
          case EQUAL:
            this.state = S_ATTRIB_VALUE;
            break;
          default:
            this.fail("attribute without value.");
            this.text = "";
            this.name = "";
            if (c === GREATER) {
              this.openTag();
            } else if (isNameStartChar(c)) {
              this.unget();
              this.state = S_ATTRIB_NAME;
            } else {
              this.fail("disallowed character in attribute name.");
              this.state = S_ATTRIB;
            }
        }
      }
      sAttribValue() {
        const c = this.getCodeNorm();
        if (isQuote(c)) {
          this.q = c;
          this.state = S_ATTRIB_VALUE_QUOTED;
        } else if (!isS(c)) {
          this.fail("unquoted attribute value.");
          this.state = S_ATTRIB_VALUE_UNQUOTED;
          this.unget();
        }
      }
      sAttribValueQuoted() {
        const { q, chunk } = this;
        let { i: start } = this;
        while (true) {
          switch (this.getCode()) {
            case q:
              this.pushAttrib(this.name, this.text + chunk.slice(start, this.prevI));
              this.name = this.text = "";
              this.q = null;
              this.state = S_ATTRIB_VALUE_CLOSED;
              return;
            case AMP:
              this.text += chunk.slice(start, this.prevI);
              this.state = S_ENTITY;
              this.entityReturnState = S_ATTRIB_VALUE_QUOTED;
              return;
            case NL:
            case NL_LIKE:
            case TAB:
              this.text += `${chunk.slice(start, this.prevI)} `;
              start = this.i;
              break;
            case LESS:
              this.text += chunk.slice(start, this.prevI);
              this.fail("disallowed character.");
              return;
            case EOC:
              this.text += chunk.slice(start);
              return;
            default:
          }
        }
      }
      sAttribValueClosed() {
        const c = this.getCodeNorm();
        if (isS(c)) {
          this.state = S_ATTRIB;
        } else if (c === GREATER) {
          this.openTag();
        } else if (c === FORWARD_SLASH) {
          this.state = S_OPEN_TAG_SLASH;
        } else if (isNameStartChar(c)) {
          this.fail("no whitespace between attributes.");
          this.unget();
          this.state = S_ATTRIB_NAME;
        } else {
          this.fail("disallowed character in attribute name.");
        }
      }
      sAttribValueUnquoted() {
        const c = this.captureTo(ATTRIB_VALUE_UNQUOTED_TERMINATOR);
        switch (c) {
          case AMP:
            this.state = S_ENTITY;
            this.entityReturnState = S_ATTRIB_VALUE_UNQUOTED;
            break;
          case LESS:
            this.fail("disallowed character.");
            break;
          case EOC:
            break;
          default:
            if (this.text.includes("]]>")) {
              this.fail('the string "]]>" is disallowed in char data.');
            }
            this.pushAttrib(this.name, this.text);
            this.name = this.text = "";
            if (c === GREATER) {
              this.openTag();
            } else {
              this.state = S_ATTRIB;
            }
        }
      }
      sCloseTag() {
        const c = this.captureNameChars();
        if (c === GREATER) {
          this.closeTag();
        } else if (isS(c)) {
          this.state = S_CLOSE_TAG_SAW_WHITE;
        } else if (c !== EOC) {
          this.fail("disallowed character in closing tag.");
        }
      }
      sCloseTagSawWhite() {
        switch (this.skipSpaces()) {
          case GREATER:
            this.closeTag();
            break;
          case EOC:
            break;
          default:
            this.fail("disallowed character in closing tag.");
        }
      }
      // END OF STATE ENGINE METHODS
      handleTextInRoot() {
        let { i: start, forbiddenState } = this;
        const { chunk, textHandler: handler } = this;
        scanLoop:
          while (true) {
            switch (this.getCode()) {
              case LESS: {
                this.state = S_OPEN_WAKA;
                if (handler !== void 0) {
                  const { text } = this;
                  const slice = chunk.slice(start, this.prevI);
                  if (text.length !== 0) {
                    handler(text + slice);
                    this.text = "";
                  } else if (slice.length !== 0) {
                    handler(slice);
                  }
                }
                forbiddenState = FORBIDDEN_START;
                break scanLoop;
              }
              case AMP:
                this.state = S_ENTITY;
                this.entityReturnState = S_TEXT;
                if (handler !== void 0) {
                  this.text += chunk.slice(start, this.prevI);
                }
                forbiddenState = FORBIDDEN_START;
                break scanLoop;
              case CLOSE_BRACKET:
                switch (forbiddenState) {
                  case FORBIDDEN_START:
                    forbiddenState = FORBIDDEN_BRACKET;
                    break;
                  case FORBIDDEN_BRACKET:
                    forbiddenState = FORBIDDEN_BRACKET_BRACKET;
                    break;
                  case FORBIDDEN_BRACKET_BRACKET:
                    break;
                  default:
                    throw new Error("impossible state");
                }
                break;
              case GREATER:
                if (forbiddenState === FORBIDDEN_BRACKET_BRACKET) {
                  this.fail('the string "]]>" is disallowed in char data.');
                }
                forbiddenState = FORBIDDEN_START;
                break;
              case NL_LIKE:
                if (handler !== void 0) {
                  this.text += `${chunk.slice(start, this.prevI)}
`;
                }
                start = this.i;
                forbiddenState = FORBIDDEN_START;
                break;
              case EOC:
                if (handler !== void 0) {
                  this.text += chunk.slice(start);
                }
                break scanLoop;
              default:
                forbiddenState = FORBIDDEN_START;
            }
          }
        this.forbiddenState = forbiddenState;
      }
      handleTextOutsideRoot() {
        let { i: start } = this;
        const { chunk, textHandler: handler } = this;
        let nonSpace = false;
        outRootLoop:
          while (true) {
            const code = this.getCode();
            switch (code) {
              case LESS: {
                this.state = S_OPEN_WAKA;
                if (handler !== void 0) {
                  const { text } = this;
                  const slice = chunk.slice(start, this.prevI);
                  if (text.length !== 0) {
                    handler(text + slice);
                    this.text = "";
                  } else if (slice.length !== 0) {
                    handler(slice);
                  }
                }
                break outRootLoop;
              }
              case AMP:
                this.state = S_ENTITY;
                this.entityReturnState = S_TEXT;
                if (handler !== void 0) {
                  this.text += chunk.slice(start, this.prevI);
                }
                nonSpace = true;
                break outRootLoop;
              case NL_LIKE:
                if (handler !== void 0) {
                  this.text += `${chunk.slice(start, this.prevI)}
`;
                }
                start = this.i;
                break;
              case EOC:
                if (handler !== void 0) {
                  this.text += chunk.slice(start);
                }
                break outRootLoop;
              default:
                if (!isS(code)) {
                  nonSpace = true;
                }
            }
          }
        if (!nonSpace) {
          return;
        }
        if (!this.sawRoot && !this.reportedTextBeforeRoot) {
          this.fail("text data outside of root node.");
          this.reportedTextBeforeRoot = true;
        }
        if (this.closedRoot && !this.reportedTextAfterRoot) {
          this.fail("text data outside of root node.");
          this.reportedTextAfterRoot = true;
        }
      }
      pushAttribNS(name, value) {
        var _a;
        const { prefix, local } = this.qname(name);
        const attr = { name, prefix, local, value };
        this.attribList.push(attr);
        (_a = this.attributeHandler) === null || _a === void 0 ? void 0 : _a.call(this, attr);
        if (prefix === "xmlns") {
          const trimmed = value.trim();
          if (this.currentXMLVersion === "1.0" && trimmed === "") {
            this.fail("invalid attempt to undefine prefix in XML 1.0");
          }
          this.topNS[local] = trimmed;
          nsPairCheck(this, local, trimmed);
        } else if (name === "xmlns") {
          const trimmed = value.trim();
          this.topNS[""] = trimmed;
          nsPairCheck(this, "", trimmed);
        }
      }
      pushAttribPlain(name, value) {
        var _a;
        const attr = { name, value };
        this.attribList.push(attr);
        (_a = this.attributeHandler) === null || _a === void 0 ? void 0 : _a.call(this, attr);
      }
      /**
       * End parsing. This performs final well-formedness checks and resets the
       * parser to a clean state.
       *
       * @returns this
       */
      end() {
        var _a, _b;
        if (!this.sawRoot) {
          this.fail("document must contain a root element.");
        }
        const { tags } = this;
        while (tags.length > 0) {
          const tag = tags.pop();
          this.fail(`unclosed tag: ${tag.name}`);
        }
        if (this.state !== S_BEGIN && this.state !== S_TEXT) {
          this.fail("unexpected end.");
        }
        const { text } = this;
        if (text.length !== 0) {
          (_a = this.textHandler) === null || _a === void 0 ? void 0 : _a.call(this, text);
          this.text = "";
        }
        this._closed = true;
        (_b = this.endHandler) === null || _b === void 0 ? void 0 : _b.call(this);
        this._init();
        return this;
      }
      /**
       * Resolve a namespace prefix.
       *
       * @param prefix The prefix to resolve.
       *
       * @returns The namespace URI or ``undefined`` if the prefix is not defined.
       */
      resolve(prefix) {
        var _a, _b;
        let uri = this.topNS[prefix];
        if (uri !== void 0) {
          return uri;
        }
        const { tags } = this;
        for (let index = tags.length - 1; index >= 0; index--) {
          uri = tags[index].ns[prefix];
          if (uri !== void 0) {
            return uri;
          }
        }
        uri = this.ns[prefix];
        if (uri !== void 0) {
          return uri;
        }
        return (_b = (_a = this.opt).resolvePrefix) === null || _b === void 0 ? void 0 : _b.call(_a, prefix);
      }
      /**
       * Parse a qname into its prefix and local name parts.
       *
       * @param name The name to parse
       *
       * @returns
       */
      qname(name) {
        const colon = name.indexOf(":");
        if (colon === -1) {
          return { prefix: "", local: name };
        }
        const local = name.slice(colon + 1);
        const prefix = name.slice(0, colon);
        if (prefix === "" || local === "" || local.includes(":")) {
          this.fail(`malformed name: ${name}.`);
        }
        return { prefix, local };
      }
      processAttribsNS() {
        var _a;
        const { attribList } = this;
        const tag = this.tag;
        {
          const { prefix, local } = this.qname(tag.name);
          tag.prefix = prefix;
          tag.local = local;
          const uri = tag.uri = (_a = this.resolve(prefix)) !== null && _a !== void 0 ? _a : "";
          if (prefix !== "") {
            if (prefix === "xmlns") {
              this.fail('tags may not have "xmlns" as prefix.');
            }
            if (uri === "") {
              this.fail(`unbound namespace prefix: ${JSON.stringify(prefix)}.`);
              tag.uri = prefix;
            }
          }
        }
        if (attribList.length === 0) {
          return;
        }
        const { attributes } = tag;
        const seen = /* @__PURE__ */ new Set();
        for (const attr of attribList) {
          const { name, prefix, local } = attr;
          let uri;
          let eqname;
          if (prefix === "") {
            uri = name === "xmlns" ? XMLNS_NAMESPACE : "";
            eqname = name;
          } else {
            uri = this.resolve(prefix);
            if (uri === void 0) {
              this.fail(`unbound namespace prefix: ${JSON.stringify(prefix)}.`);
              uri = prefix;
            }
            eqname = `{${uri}}${local}`;
          }
          if (seen.has(eqname)) {
            this.fail(`duplicate attribute: ${eqname}.`);
          }
          seen.add(eqname);
          attr.uri = uri;
          attributes[name] = attr;
        }
        this.attribList = [];
      }
      processAttribsPlain() {
        const { attribList } = this;
        const attributes = this.tag.attributes;
        for (const { name, value } of attribList) {
          if (attributes[name] !== void 0) {
            this.fail(`duplicate attribute: ${name}.`);
          }
          attributes[name] = value;
        }
        this.attribList = [];
      }
      /**
       * Handle a complete open tag. This parser code calls this once it has seen
       * the whole tag. This method checks for well-formeness and then emits
       * ``onopentag``.
       */
      openTag() {
        var _a;
        this.processAttribs();
        const { tags } = this;
        const tag = this.tag;
        tag.isSelfClosing = false;
        (_a = this.openTagHandler) === null || _a === void 0 ? void 0 : _a.call(this, tag);
        tags.push(tag);
        this.state = S_TEXT;
        this.name = "";
      }
      /**
       * Handle a complete self-closing tag. This parser code calls this once it has
       * seen the whole tag. This method checks for well-formeness and then emits
       * ``onopentag`` and ``onclosetag``.
       */
      openSelfClosingTag() {
        var _a, _b, _c;
        this.processAttribs();
        const { tags } = this;
        const tag = this.tag;
        tag.isSelfClosing = true;
        (_a = this.openTagHandler) === null || _a === void 0 ? void 0 : _a.call(this, tag);
        (_b = this.closeTagHandler) === null || _b === void 0 ? void 0 : _b.call(this, tag);
        const top = this.tag = (_c = tags[tags.length - 1]) !== null && _c !== void 0 ? _c : null;
        if (top === null) {
          this.closedRoot = true;
        }
        this.state = S_TEXT;
        this.name = "";
      }
      /**
       * Handle a complete close tag. This parser code calls this once it has seen
       * the whole tag. This method checks for well-formeness and then emits
       * ``onclosetag``.
       */
      closeTag() {
        const { tags, name } = this;
        this.state = S_TEXT;
        this.name = "";
        if (name === "") {
          this.fail("weird empty close tag.");
          this.text += "</>";
          return;
        }
        const handler = this.closeTagHandler;
        let l = tags.length;
        while (l-- > 0) {
          const tag = this.tag = tags.pop();
          this.topNS = tag.ns;
          handler === null || handler === void 0 ? void 0 : handler(tag);
          if (tag.name === name) {
            break;
          }
          this.fail("unexpected close tag.");
        }
        if (l === 0) {
          this.closedRoot = true;
        } else if (l < 0) {
          this.fail(`unmatched closing tag: ${name}.`);
          this.text += `</${name}>`;
        }
      }
      /**
       * Resolves an entity. Makes any necessary well-formedness checks.
       *
       * @param entity The entity to resolve.
       *
       * @returns The parsed entity.
       */
      parseEntity(entity) {
        if (entity[0] !== "#") {
          const defined = this.ENTITIES[entity];
          if (defined !== void 0) {
            return defined;
          }
          this.fail(this.isName(entity) ? "undefined entity." : "disallowed character in entity name.");
          return `&${entity};`;
        }
        let num = NaN;
        if (entity[1] === "x" && /^#x[0-9a-f]+$/i.test(entity)) {
          num = parseInt(entity.slice(2), 16);
        } else if (/^#[0-9]+$/.test(entity)) {
          num = parseInt(entity.slice(1), 10);
        }
        if (!this.isChar(num)) {
          this.fail("malformed character entity.");
          return `&${entity};`;
        }
        return String.fromCodePoint(num);
      }
    };
    exports.SaxesParser = SaxesParser2;
  }
});

// portable/worker.mjs
import { readFileSync as readFileSync2, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// portable/fidelity.ts
var import_saxes = __toESM(require_saxes(), 1);
var namespace = "http://www.w3.org/2000/svg";
var normalizedText = (text) => text.normalize("NFC").replace(/\s+/g, " ").trim();
var ordered = (values) => [...values].map((value) => JSON.stringify(value)).sort();
var same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
var multiset = (values) => ordered(values);
var pair = (value) => [value.source, value.target];
var object = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : void 0;
var entries = (value) => {
  const record = object(value);
  return value instanceof Map ? [...value.entries()] : record ? Object.entries(record) : [];
};
var array = (value) => Array.isArray(value) ? value : [];
function parseSvg(svg) {
  let root, current, problem;
  const parser = new import_saxes.SaxesParser({ xmlns: true });
  parser.on("error", (error) => {
    problem ??= error;
  });
  parser.on("opentag", (tag) => {
    const element = { tag: tag.local, uri: tag.uri, attributes: Object.fromEntries(Object.values(tag.attributes).map((attribute) => [attribute.name, attribute.value])), children: [], text: "", ...current ? { parent: current } : {} };
    if (!root) root = element;
    current?.children.push(element);
    current = element;
  });
  parser.on("text", (text) => {
    if (current) current.text += text;
  });
  parser.on("cdata", (text) => {
    if (current) current.text += text;
  });
  parser.on("closetag", () => {
    current = current?.parent;
  });
  parser.write(svg).close();
  if (problem) throw problem;
  if (!root || root.tag !== "svg" || root.uri !== namespace) throw Error("Output is not a namespaced SVG root");
  return root;
}
var all = (element) => [element, ...element.children.flatMap(all)];
var hasClass = (element, value) => element.attributes.class?.split(/\s+/).includes(value) ?? false;
function visible(element) {
  for (let current = element; current; current = current.parent) {
    const attributes = current.attributes, style = attributes.style ?? "";
    if (["defs", "metadata", "style", "script", "title", "desc"].includes(current.tag) || attributes.display === "none" || ["hidden", "collapse"].includes(attributes.visibility ?? "") || attributes.opacity === "0" || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|opacity\s*:\s*0(?:[;\s]|$)|font-size\s*:\s*0(?:px)?(?:[;\s]|$))/i.test(style))
      return false;
  }
  return true;
}
function renderedText(element) {
  for (let current = element; current; current = current.parent) {
    if (current.uri === namespace && ["text", "tspan", "textPath"].includes(current.tag)) return true;
    if (element.uri === "http://www.w3.org/1999/xhtml" && current.uri === namespace && current.tag === "foreignObject") return true;
  }
  return false;
}
var textIn = (element) => normalizedText(
  all(element).filter((item) => visible(item) && renderedText(item)).map((item) => item.text).join(" ")
);
var finiteLength = (value) => value !== void 0 && /^[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?(?:px)?$/i.test(value.trim()) && Number.isFinite(Number.parseFloat(value)) ? Number.parseFloat(value) : void 0;
function canvas(root) {
  const box = root.attributes.viewBox?.trim().split(/[\s,]+/).map(Number);
  if (box?.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0) return true;
  return (finiteLength(root.attributes.width) ?? 0) > 0 && (finiteLength(root.attributes.height) ?? 0) > 0;
}
function translation(element) {
  const point = { x: 0, y: 0 };
  for (let current = element; current; current = current.parent) {
    const transform = current.attributes.transform;
    if (!transform) continue;
    const match = /^translate\(\s*([-+\d.eE]+)(?:[\s,]+([-+\d.eE]+))?\s*\)$/.exec(transform);
    if (!match) return void 0;
    const x = Number(match[1]), y = Number(match[2] ?? 0);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return void 0;
    point.x += x;
    point.y += y;
  }
  return point;
}
function shapeBounds(owner) {
  const shape = owner.children.find((child) => child.uri === namespace && visible(child) && ["rect", "circle", "ellipse", "polygon"].includes(child.tag));
  if (!shape) return void 0;
  const position = translation(shape);
  if (!position) return void 0;
  const a = shape.attributes, n = (key, fallback = 0) => finiteLength(a[key]) ?? fallback;
  let box;
  if (shape.tag === "rect") box = { x: n("x"), y: n("y"), width: n("width"), height: n("height") };
  else if (shape.tag === "circle" || shape.tag === "ellipse") {
    const rx = n(shape.tag === "circle" ? "r" : "rx"), ry = n(shape.tag === "circle" ? "r" : "ry");
    box = { x: n("cx") - rx, y: n("cy") - ry, width: 2 * rx, height: 2 * ry };
  } else {
    const values = (a.points ?? "").trim().split(/[\s,]+/).map(Number);
    if (values.length < 6 || values.length % 2 || !values.every(Number.isFinite)) return void 0;
    const xs = values.filter((_value, index) => index % 2 === 0), ys = values.filter((_value, index) => index % 2 === 1);
    box = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  }
  return box.width > 0 && box.height > 0 ? { ...box, x: box.x + position.x, y: box.y + position.y } : void 0;
}
function pathEndpoints(path) {
  const tokens = path.attributes.d?.match(/[a-zA-Z]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/g);
  const shift = translation(path);
  if (!tokens?.length || !shift) return void 0;
  let cursor = 0, command = "", current = { x: 0, y: 0 }, start, subpath = { x: 0, y: 0 }, hasSegment = false;
  const arity = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 };
  while (cursor < tokens.length) {
    if (/^[a-z]$/i.test(tokens[cursor])) command = tokens[cursor++];
    const upper = command.toUpperCase(), relative = command !== upper;
    if (upper === "Z") {
      current = { ...subpath };
      command = "";
      continue;
    }
    const count = arity[upper];
    if (!count || cursor + count > tokens.length) return void 0;
    const values = tokens.slice(cursor, cursor + count).map(Number);
    if (!values.every(Number.isFinite)) return void 0;
    cursor += count;
    const previous = { ...current }, origin = relative ? current : { x: 0, y: 0 };
    if (upper === "H") current = { x: origin.x + values[0], y: current.y };
    else if (upper === "V") current = { x: current.x, y: origin.y + values[0] };
    else current = { x: origin.x + values[count - 2], y: origin.y + values[count - 1] };
    if (upper === "M") {
      start ??= { ...current };
      subpath = { ...current };
      command = relative ? "l" : "L";
    } else hasSegment ||= current.x !== previous.x || current.y !== previous.y || ["C", "S", "Q"].includes(upper) && values.slice(0, -2).some((value, index) => value + (index % 2 ? origin.y : origin.x) !== (index % 2 ? previous.y : previous.x));
  }
  return start && hasSegment ? { start: { x: start.x + shift.x, y: start.y + shift.y }, end: { x: current.x + shift.x, y: current.y + shift.y } } : void 0;
}
function markerTriangle(path) {
  const values = path.attributes.d?.match(/[a-zA-Z]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/g), shift = translation(path);
  if (!values || !shift || values.length !== 10 || values[0] !== "M" || values[3] !== "L" || values[6] !== "L" || values[9] !== "Z") return void 0;
  const [x, y, ax, ay, bx, by] = [values[1], values[2], values[4], values[5], values[7], values[8]].map(Number);
  if (![x, y, ax, ay, bx, by].every(Number.isFinite) || Math.abs((ax - x) * (by - y) - (ay - y) * (bx - x)) < 1e-6) return void 0;
  return { tip: { x: x + shift.x, y: y + shift.y }, base: { x: (ax + bx) / 2 + shift.x, y: (ay + by) / 2 + shift.y } };
}
function arrowPointsInto(marker, box) {
  const toward = { x: box.x + box.width / 2 - marker.tip.x, y: box.y + box.height / 2 - marker.tip.y };
  return distance(marker.tip, box) <= 12 && (marker.tip.x - marker.base.x) * toward.x + (marker.tip.y - marker.base.y) * toward.y > 0;
}
function distance(point, box) {
  const dx = Math.max(box.x - point.x, 0, point.x - box.x - box.width), dy = Math.max(box.y - point.y, 0, point.y - box.y - box.height);
  return dx || dy ? Math.hypot(dx, dy) : Math.min(point.x - box.x, box.x + box.width - point.x, point.y - box.y, box.y + box.height - point.y);
}
function contained(inner, outer) {
  return inner.x >= outer.x - 1 && inner.y >= outer.y - 1 && inner.x + inner.width <= outer.x + outer.width + 1 && inner.y + inner.height <= outer.y + outer.height + 1;
}
function nativeTopology(model) {
  const links = (items, from, to) => items.map((item) => ({ source: String(item[from]), target: String(item[to]), ...typeof item.id === "string" ? { svgId: item.id } : {} }));
  switch (model.type) {
    case "flowchart":
      return { nodes: entries(model.nodes).map(([key]) => key), edges: links(array(model.edges), "start", "end"), labels: Object.fromEntries(entries(model.nodes).map(([key, node]) => [key, node.text])), groups: array(model.subgraphs).map((group) => ({ id: group.id, members: group.nodes })) };
    case "sequence":
      return {
        nodes: entries(model.actors).map(([key]) => key),
        labels: Object.fromEntries(entries(model.actors).map(([key, actor]) => [key, actor.description ?? actor.name ?? key])),
        edges: links(
          array(model.messages).filter((item) => item.from !== void 0 && item.to !== void 0),
          "from",
          "to"
        )
      };
    case "class":
      return { nodes: entries(model.classes).map(([key]) => key), edges: links(array(model.relations), "id1", "id2"), labels: Object.fromEntries(entries(model.classes).map(([key, item]) => [key, item.label ?? key])) };
    case "state":
      return { nodes: entries(model.states).map(([key]) => key), edges: links(array(model.relations), "id1", "id2"), labels: Object.fromEntries(entries(model.states).map(([key, item]) => [key, array(item.descriptions).join("\n") || key])) };
    case "er": {
      const names = new Map(entries(model.entities).map(([key, entity]) => [entity.id, key]));
      return {
        nodes: entries(model.entities).map(([key]) => key),
        edges: array(model.relationships).map((item) => ({ source: names.get(item.entityA) ?? String(item.entityA), target: names.get(item.entityB) ?? String(item.entityB) })),
        labels: Object.fromEntries(entries(model.entities).map(([key, item]) => [key, item.alias || item.label || key]))
      };
    }
    case "architecture":
      return {
        nodes: entries(model.nodes).map(([key]) => key),
        edges: links(array(model.edges), "lhsId", "rhsId"),
        groups: entries(model.groups).map(([id]) => ({
          id,
          members: entries(model.nodes).filter(([_key, node]) => node.in === id).map(([key]) => key)
        }))
      };
    case "requirement":
      return { nodes: [...entries(model.requirements), ...entries(model.elements)].map(([key]) => key), edges: links(array(model.relations), "src", "dst") };
    case "sankey":
      return { nodes: array(model.nodes).map((node) => node.id), edges: array(model.links).map((item) => ({ source: item.source.id, target: item.target.id })) };
    case "c4":
      return { nodes: array(model.shapes).map((item) => item.alias), edges: links(array(model.rels), "from", "to") };
    default:
      return void 0;
  }
}
function modelPath(model, path) {
  let current = model;
  for (const key of path) {
    if (typeof key === "object") {
      if (!(current instanceof Map)) return void 0;
      current = current.get(key.map);
    } else {
      if (current === null || current === void 0) return void 0;
      current = current[key];
    }
  }
  return current;
}
var displayValue = (value) => typeof value === "string" ? normalizedText(value) : Array.isArray(value) ? value.map(displayValue) : value;
function leafMembers(group, groups, seen = /* @__PURE__ */ new Set()) {
  if (seen.has(group.id)) return [];
  seen.add(group.id);
  return [
    ...new Set(
      group.members.flatMap((member) => {
        const child = groups.find((item) => item.id === member);
        return child ? leafMembers(child, groups, new Set(seen)) : [member];
      })
    )
  ].sort();
}
function qualifyPortableUnchecked(testCase, output) {
  const checks = [], unmeasuredScopes = ["Perceptual legibility, font metrics, text clipping and complete shape/path paint correspondence are not measured."];
  const accepted = output.error === void 0;
  const check = (name, expected2, actual, scope, available = true) => checks.push({ name, status: !available ? "unmeasured" : same(expected2, actual) ? "passed" : "failed", expected: expected2, actual: actual === void 0 ? null : actual, scope });
  check("acceptance", testCase.expected.accept, accepted, "Actual public renderer return versus exception; a non-SVG return is still acceptance and fails format separately.");
  if (!testCase.expected.accept || !accepted) return { accepted, passed: checks.every((item) => item.status === "passed"), semanticComplete: false, checks, unmeasuredScopes, scope: "Public acceptance/rejection only; no positive rendered semantic witness." };
  let root;
  try {
    if (typeof output.svg !== "string") throw Error("Public renderer returned no SVG string");
    root = parseSvg(output.svg);
    check("svg-format", true, true, "Strict XML and SVG root namespace.");
  } catch (error) {
    check("svg-format", "valid namespaced SVG", String(error), "Strict XML and SVG root namespace.");
  }
  check("positive-canvas", true, root ? canvas(root) : false, "Positive finite viewBox or explicit width/height.");
  if (typeof testCase.renderOptions?.fontSize === "number") {
    const style = root?.attributes.style ?? "";
    const size = /(?:^|;)\s*font-size\s*:\s*([\d.]+)px/.exec(style)?.[1] ?? /(?:^|;)\s*font\s*:\s*([\d.]+)px/.exec(style)?.[1];
    check("svg-root-font-size", testCase.renderOptions.fontSize, size === void 0 ? null : Number(size), "Authored fontSize is emitted as an SVG root font declaration. Computed CSS, glyph metrics and clipping remain unmeasured.");
  }
  const nodes = root ? all(root) : [], visibleText = root ? textIn(root) : "";
  for (const label of testCase.expected.labels) check("label:" + label, true, visibleText.includes(normalizedText(label)), "Authored rendered text, excluding hidden/metadata/defs text; computed CSS and clipping remain unmeasured.");
  const ids = nodes.map((element) => element.attributes.id).filter((id) => !!id);
  check("svg-unique-ids", ids.length, new Set(ids).size, "Document IDs must be unique; repeated data-id values are renderer-specific.");
  const model = object(output.model), topology = model ? nativeTopology(model) : void 0, expected = testCase.expected.topology;
  const modelChecks = checks.length;
  for (const assertion of testCase.expected.model ?? []) {
    const value = modelPath(output.model, assertion.path), display = assertion.comparison === "display-text";
    check(
      "model:" + JSON.stringify(assertion.path),
      display ? displayValue(assertion.value) : assertion.value,
      display ? displayValue(value) : value,
      "Authored expected value against separately invoked public parse model; not a claim about painted output." + (display ? " Declared display-text comparison normalizes whitespace/NFC." : ""),
      model !== void 0
    );
  }
  if (expected) {
    check("model-node-identities", multiset(expected.nodes), multiset(topology?.nodes ?? []), "Exact authored node identity multiset in public parse model.", topology !== void 0);
    check("model-edge-endpoints-and-multiplicity", multiset(expected.edges.map(pair)), multiset((topology?.edges ?? []).map(pair)), "Directed endpoint pair multiset; parallel and reciprocal edges stay distinct.", topology !== void 0);
    if (model?.type === "sequence") check("model-message-order", expected.edges.map(pair), (topology?.edges ?? []).map(pair), "Authored message endpoint order is significant in a sequence diagram.", topology !== void 0);
    for (const [id, label] of Object.entries(expected.nodeLabels ?? {})) check("model-node-label:" + id, label, topology?.labels?.[id], "Authored label belongs to its authored public-model node identity.", topology?.labels !== void 0);
    for (const group of expected.groups ?? []) {
      const actual = topology?.groups?.find((item) => item.id === group.id);
      check("model-group-membership:" + group.id, leafMembers(group, expected.groups ?? []), actual ? leafMembers(actual, topology.groups) : null, "Descendant leaf membership, normalizing nested group representation.", topology?.groups !== void 0);
    }
  }
  const nativeChecks = checks.slice(modelChecks);
  const nativeComplete = nativeChecks.length > 0 && nativeChecks.every((item) => item.status === "passed");
  let paintComplete = false;
  if (expected && root && hasClass(root, "pele") && ["flowchart", "class", "state", "er"].includes(model?.type)) {
    const drawnNodes = nodes.filter((element) => element.uri === namespace && visible(element) && hasClass(element, "pele-node"));
    const drawnEdges = nodes.filter((element) => element.uri === namespace && visible(element) && hasClass(element, "pele-edge"));
    const drawnGroups = nodes.filter((element) => element.uri === namespace && visible(element) && hasClass(element, "pele-cluster"));
    const paintChecks = checks.length;
    const flowchart = model.type === "flowchart";
    check("svg-family-owner", true, model.type === testCase.family && hasClass(root, "pele-" + testCase.family), "The public model and owned SVG root identify the authored diagram family.");
    check("svg-owned-node-identities", multiset(expected.nodes), multiset(drawnNodes.map((element) => element.attributes["data-id"])), "Pele owned node groups; each authored node appears exactly once.");
    for (const [id, label] of Object.entries(expected.nodeLabels ?? {})) {
      const owners = drawnNodes.filter((element) => element.attributes["data-id"] === id);
      check("svg-owned-node-label:" + id, true, owners.length === 1 && textIn(owners[0]).includes(normalizedText(label)), "Authored label is painted under its authored node owner.");
    }
    const bounds = new Map(drawnNodes.map((element) => [element.attributes["data-id"], shapeBounds(element)]));
    const geometryAvailable = drawnNodes.length === expected.nodes.length && [...bounds.values()].every(Boolean);
    const endpointOwner = (point) => {
      const candidates = [...bounds].filter(([_id, box]) => box && distance(point, box) <= 12);
      return candidates.length === 1 ? candidates[0][0] : void 0;
    };
    const observedEdges = [];
    let bindingsMeasured = true;
    check(
      "svg-owned-edge-identities",
      true,
      drawnEdges.every((owner) => !!owner.attributes["data-id"]) && new Set(drawnEdges.map((owner) => owner.attributes["data-id"])).size === drawnEdges.length,
      "Every drawn relation has a nonempty unique owner identity; duplicate data-id values cannot impersonate distinct parallel relations."
    );
    for (const [index, owner] of drawnEdges.entries()) {
      const id = owner.attributes["data-id"];
      const matches = (topology?.edges ?? []).filter((item) => item.svgId === id);
      const ink = owner.children.filter((element) => element.uri === namespace && element.tag === "path" && !hasClass(element, "pele-marker") && visible(element) && !!element.attributes.d);
      check(`svg-edge-owned-ink:${index}`, true, ink.length > 0, "An owned edge needs rendered path data; IDs or text sidecars alone do not qualify.");
      const endpoints = ink[0] ? pathEndpoints(ink[0]) : void 0;
      const geometricSource = endpoints ? endpointOwner(endpoints.start) : void 0, geometricTarget = endpoints ? endpointOwner(endpoints.end) : void 0;
      const binding = flowchart ? matches.length === 1 ? matches[0] : void 0 : geometricSource && geometricTarget ? { source: geometricSource, target: geometricTarget } : void 0;
      if (!binding) bindingsMeasured = false;
      else observedEdges.push(binding);
      const source = binding ? bounds.get(binding.source) : void 0, target = binding ? bounds.get(binding.target) : void 0;
      const attachment = endpoints && source && target ? distance(endpoints.start, source) <= 12 && distance(endpoints.end, target) <= 12 : !flowchart && geometryAvailable && endpoints ? false : null;
      check(
        `svg-edge-attachment:${index}`,
        true,
        attachment,
        "Connecting path endpoints touch their owned node bounding boxes within12px, allowing marker inset. Class/state/ER endpoints must each identify a unique visible owner. Curve interiors and exact shape boundaries remain unmeasured.",
        !!endpoints && (flowchart ? !!source && !!target : geometryAvailable)
      );
      const markers = owner.children.filter((element) => element.uri === namespace && hasClass(element, "pele-marker") && visible(element));
      if (model.type === "er") {
        const ends = markers.filter((marker) => marker.tag === "path").map(pathEndpoints).filter((points) => !!points);
        check(
          `svg-edge-end-markers:${index}`,
          true,
          source && target ? ends.some((points) => Math.min(distance(points.start, source), distance(points.end, source)) <= 12) && ends.some((points) => Math.min(distance(points.start, target), distance(points.end, target)) <= 12) : null,
          "Visible cardinality path ink is attached to both entity ends. Exact cardinality glyph meaning is not independently asserted by this topology projection.",
          !!source && !!target
        );
      } else {
        const triangles = markers.filter((marker) => marker.tag === "path").map(markerTriangle).filter((triangle) => !!triangle);
        const classProfile = model.type !== "class" || array(model.relations).every((relation) => relation.relation?.type1 === "none" && relation.relation?.type2 === 3);
        check(
          `svg-edge-target-marker:${index}`,
          true,
          target ? triangles.some((triangle) => arrowPointsInto(triangle, target)) : null,
          "The reviewed ordinary directed relation has a nondegenerate triangular arrowhead pointing into its logical target within12px. Other class relation marker profiles are unmeasured.",
          !!target && classProfile
        );
      }
    }
    check(
      "svg-owned-edge-endpoints-and-multiplicity",
      multiset(expected.edges.map(pair)),
      multiset(observedEdges.map(pair)),
      flowchart ? "Pele flowchart SVG edge ownership bound to public parse IDs and actual path ink." : "Class/state/ER actual path endpoints bind independently to unique owned node bounds; directed pair multiplicity is compared with authored expectations without guessing generated relation IDs.",
      bindingsMeasured
    );
    check("svg-owned-edge-count", expected.edges.length, drawnEdges.length, "Exact number of drawn edge owners, independently of model and labels.");
    for (const group of expected.groups ?? []) {
      const owner = drawnGroups.find((element) => element.attributes["data-id"] === group.id), groupBox = owner ? shapeBounds(owner) : void 0;
      const children = group.members.map((id) => bounds.get(id) ?? (drawnGroups.find((element) => element.attributes["data-id"] === id) ? shapeBounds(drawnGroups.find((element) => element.attributes["data-id"] === id)) : void 0));
      check("svg-group-containment:" + group.id, true, groupBox && children.every(Boolean) ? children.every((child) => contained(child, groupBox)) : null, "Authored direct members are painted inside their owner cluster bounding box.", !!groupBox && children.every(Boolean));
    }
    paintComplete = checks.slice(paintChecks).every((item) => item.status === "passed");
    unmeasuredScopes.push(
      "Graph checks cover owner identity, declared label ownership, edge count/endpoints, approximate attachment, ordinary directed markers or ER endpoint marker ink, and optional group containment. Crossings, full curve geometry, arbitrary transforms, unasserted class member/ER cardinality meaning and undeclared label-owner assignments remain unmeasured."
    );
  } else if (expected && root && hasClass(root, "pele") && model?.type === "sequence") {
    const paintChecks = checks.length;
    const messages = array(model.messages), connections = messages.filter((message) => message.from !== void 0 && message.to !== void 0);
    const profile = connections.length === messages.length && connections.every((message) => [0, 1].includes(message.type) && message.from !== message.to && !message.activate && !message.centralConnection) && !array(model.notes).length && !array(model.boxes).length && !entries(model.createdActors).length && !entries(model.destroyedActors).length && !entries(model.active).length && entries(model.actors).every(([_id, actor]) => actor.type === "participant");
    check("svg-sequence-message-profile", true, profile, "Reviewed simple directed participant messages only; self, bidirectional, lifecycle, notes, boxes and control-block paint remain unmeasured.", profile);
    check("svg-family-owner", true, testCase.family === "sequence" && hasClass(root, "pele-sequence"), "Public sequence model and owned SVG root identify the authored family.");
    const headers = nodes.filter((element) => element.uri === namespace && visible(element) && hasClass(element, "pele-actor") && !hasClass(element, "pele-actor-footer"));
    const lifelines = nodes.filter((element) => element.uri === namespace && visible(element) && hasClass(element, "pele-lifeline"));
    check("svg-owned-node-identities", multiset(expected.nodes), multiset(headers.map((owner) => owner.attributes["data-id"])), "Exactly one actor header owns each identity; legitimate repeated footer actors are excluded from header counting.");
    check("svg-sequence-lifeline-identities", multiset(expected.nodes), multiset(lifelines.map((owner) => owner.attributes["data-id"])), "Each actor has exactly one visible owned lifeline.");
    const lines = /* @__PURE__ */ new Map();
    for (const owner of lifelines) {
      const points = owner.tag === "path" ? pathEndpoints(owner) : void 0;
      if (points && Math.abs(points.start.x - points.end.x) < 1e-6 && points.end.y > points.start.y) lines.set(owner.attributes["data-id"], { x: points.start.x, top: points.start.y, bottom: points.end.y });
    }
    for (const [id, actor] of entries(model.actors)) {
      const owners = headers.filter((owner) => owner.attributes["data-id"] === id), header = owners.length === 1 ? owners[0] : void 0;
      const box = header ? shapeBounds(header) : void 0, line = lines.get(id);
      check("svg-sequence-actor-label:" + id, normalizedText(String(actor.description ?? actor.name ?? id)), header ? textIn(header) : null, "Header text is owned by the corresponding public actor identity; independent authored label-owner fields remain separate.");
      check("svg-sequence-lifeline-header:" + id, true, box && line ? Math.abs(box.x + box.width / 2 - line.x) <= 1 && Math.abs(box.y + box.height - line.top) <= 1 : null, "The owned vertical lifeline begins at the bottom center of its corresponding actor header.", !!box && !!line);
    }
    const ownerAt = (point) => {
      const candidates = [...lines].filter(([_id, line]) => Math.abs(point.x - line.x) <= 12 && point.y >= line.top - 1 && point.y <= line.bottom + 1);
      return candidates.length === 1 ? candidates[0][0] : void 0;
    };
    const drawn = nodes.filter((element) => element.uri === namespace && visible(element) && hasClass(element, "pele-edge") && hasClass(element, "pele-message"));
    const projected = drawn.map((owner) => {
      const ink = owner.children.filter((element) => element.uri === namespace && visible(element) && element.tag === "path" && !hasClass(element, "pele-marker") && !!element.attributes.d);
      return { owner, ink, points: ink.length === 1 ? pathEndpoints(ink[0]) : void 0 };
    }).sort((left, right) => (left.points?.start.y ?? Infinity) - (right.points?.start.y ?? Infinity));
    check("svg-owned-edge-count", expected.edges.length, drawn.length, "Exact painted message count, independent of public model and global labels.");
    check("svg-owned-edge-identities", true, drawn.every((owner) => !!owner.attributes["data-id"]) && new Set(drawn.map((owner) => owner.attributes["data-id"])).size === drawn.length, "Every painted message has a nonempty unique owner ID.");
    const observed = [], order = [];
    let endpointsMeasured = true;
    for (const [index, item] of projected.entries()) {
      const points = item.points, from = points ? ownerAt(points.start) : void 0, to = points ? ownerAt(points.end) : void 0;
      const horizontal = points ? Math.abs(points.start.y - points.end.y) <= 1 : false;
      check("svg-sequence-message-attachment:" + index, true, !!from && !!to && horizontal, "A simple message path connects two unique owned lifelines within12px. Self/control/lifecycle geometry is outside this projection.", !!points && lines.size === expected.nodes.length);
      if (from && to && horizontal) {
        observed.push({ source: from, target: to });
        order.push(points.start.y);
      } else endpointsMeasured = false;
      const sourceLine = from ? lines.get(from) : void 0, targetLine = to ? lines.get(to) : void 0;
      const triangles = item.owner.children.filter((element) => element.uri === namespace && visible(element) && hasClass(element, "pele-marker") && element.tag === "path").map(markerTriangle).filter((triangle) => !!triangle);
      check(
        "svg-sequence-target-marker:" + index,
        true,
        sourceLine && targetLine && points ? triangles.some((marker) => Math.abs(marker.tip.x - targetLine.x) <= 12 && Math.abs(marker.tip.y - points.end.y) <= 1 && (marker.tip.x - marker.base.x) * (targetLine.x - sourceLine.x) > 0) : null,
        "The nondegenerate message arrowhead points from its observed source toward the target lifeline.",
        !!sourceLine && !!targetLine && !!points && profile
      );
      const labels = nodes.filter((element) => element.uri === namespace && visible(element) && hasClass(element, "pele-edge-label") && element.attributes["data-id"] === item.owner.attributes["data-id"]);
      check(
        "svg-sequence-owned-message-label:" + index,
        normalizedText(String(connections[index]?.message ?? "")),
        labels.length === 1 ? textIn(labels[0]) : null,
        "Message text belongs to the same SVG owner as the geometrically ordered public message; an unowned global text copy cannot substitute.",
        connections[index] !== void 0
      );
    }
    check("svg-owned-edge-endpoints-and-multiplicity", expected.edges.map(pair), observed.map(pair), "Authored directed message order and multiplicity are checked against actual path-to-lifeline bindings, without guessing renderer-generated message IDs.", endpointsMeasured);
    check(
      "svg-sequence-row-order",
      true,
      order.every((value, index) => index === 0 || value > order[index - 1] + 1),
      "Simple messages occupy distinct successive rows in authored order; simultaneous/control-block layouts are outside this projection.",
      endpointsMeasured
    );
    paintComplete = checks.slice(paintChecks).every((item) => item.status === "passed");
    unmeasuredScopes.push(
      "Sequence checks cover simple participant headers/lifelines and directed message geometry, order, multiplicity and public-model label ownership. Lifecycle/self/bidirectional/control-block/activation/box/note geometry, unasserted native label assignments and complete path/text paint remain unmeasured."
    );
  } else {
    check("painted-semantic-correspondence", "native semantic facts correspond to owned visible geometry", null, "No reviewed renderer/family paint projection is available; label retention alone does not establish it.", false);
  }
  const complete = nativeComplete && paintComplete && checks.every((item) => item.status === "passed");
  return {
    accepted,
    passed: checks.every((item) => item.status === "passed"),
    semanticComplete: complete,
    checks,
    unmeasuredScopes,
    scope: complete ? model?.type === "sequence" ? "Declared simple sequence actor identities, ordered message endpoints and multiplicity plus owned lifelines, connecting path geometry, target arrows and public-model message label correspondence; not complete Mermaid or visual fidelity." : `Declared ${testCase.family} native identities/endpoints plus owned SVG identities/ink/bounding-box attachment, scoped endpoint markers and optional group criteria; not complete Mermaid or visual fidelity.` : "Public model facts and SVG admission, with painted semantic correspondence explicitly unmeasured where no reviewed projection exists."
  };
}
function qualifyPortable(testCase, output) {
  try {
    return qualifyPortableUnchecked(testCase, output);
  } catch (error) {
    return {
      accepted: output.error === void 0,
      passed: false,
      semanticComplete: false,
      checks: [{ name: "qualification-protocol", status: "failed", expected: "Inspectable public result", actual: (error instanceof Error ? error.message : String(error)).slice(0, 1e3), scope: "The qualifier could not inspect the actual result; no semantic or timing qualification is inferred." }],
      unmeasuredScopes: ["Qualification failed before all declared criteria could be checked."],
      scope: "Qualifier failure; partial observations are not a fidelity certificate."
    };
  }
}

// portable/mermaid-oracle.ts
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// tool-versions.json
var tool_versions_default = {
  schemaVersion: 1,
  aliases: {
    bezel: "crabtalk/bezel",
    "beautiful-mermaid": "lukilabs/beautiful-mermaid"
  },
  mermaidOracle: {
    tool: "mermaid-js/mermaid",
    dependencies: {
      "@mermaid-js/parser": "2.0.1",
      jsdom: "26.1.0"
    }
  },
  tools: {
    "obsidianmd/pele": {
      registry: "npm",
      package: "pele",
      version: "1.9.0"
    },
    "mermaid-js/mermaid": {
      registry: "npm",
      package: "mermaid",
      version: "12.2.0"
    },
    "@mermaid-js/mermaid-zenuml": {
      registry: "npm",
      package: "@mermaid-js/mermaid-zenuml",
      version: "1.0.1"
    }
  }
};

// portable/mermaid-oracle.ts
var MERMAID_ORACLE_PIN = {
  version: tool_versions_default.tools[tool_versions_default.mermaidOracle.tool].version,
  parser: tool_versions_default.mermaidOracle.dependencies["@mermaid-js/parser"],
  dom: tool_versions_default.mermaidOracle.dependencies.jsdom
};
var here = dirname(fileURLToPath(import.meta.url));
var packageName = (directory) => {
  try {
    return JSON.parse(readFileSync(join(directory, "package.json"), "utf8")).name;
  } catch {
    return void 0;
  }
};
function harnessRoot(_environment) {
  for (let directory = here, depth = 0; depth < 3; depth++, directory = dirname(directory)) if (packageName(directory) === "trident") return directory;
  return here;
}
var mermaidOracleDirectory = (environment = process.env) => resolve(environment.MERMAID_REFERENCE_DIR ?? join(harnessRoot(environment), "../mermaid-reference"));
function installHint(_environment) {
  return "Install it with `node commands.ts mermaid:install`, or set MERMAID_REFERENCE_DIR to an existing install.";
}
function admitMermaidOracle(directory, environment = process.env) {
  const pin = MERMAID_ORACLE_PIN;
  const refuse = (problem) => {
    throw Error(`Trident needs the pinned Mermaid oracle (mermaid ${pin.version}, @mermaid-js/parser ${pin.parser}, jsdom ${pin.dom}) at ${directory}: ${problem}. ${installHint(environment)}`);
  };
  const manifest = (require3, name) => require3.resolve.paths(name)?.map((directory2) => join(directory2, name, "package.json")).find((path) => existsSync(path)) ?? refuse(`${name} is not installed`);
  const version = (require3, name) => JSON.parse(readFileSync(manifest(require3, name), "utf8")).version;
  if (!existsSync(join(directory, "package.json"))) refuse("no install exists");
  const require2 = createRequire(join(directory, "package.json"));
  const installed = { version: version(require2, "mermaid"), parserVersion: version(createRequire(manifest(require2, "mermaid")), "@mermaid-js/parser"), domVersion: version(require2, "jsdom") };
  if (installed.version !== pin.version || installed.parserVersion !== pin.parser || installed.domVersion !== pin.dom) refuse(`found mermaid ${installed.version}, @mermaid-js/parser ${installed.parserVersion}, jsdom ${installed.domVersion}`);
  let integrity = null;
  try {
    integrity = JSON.parse(readFileSync(join(directory, "package-lock.json"), "utf8")).packages?.["node_modules/mermaid"]?.integrity ?? null;
  } catch {
  }
  return { directory, ...installed, integrity };
}
function assertMermaidOracle(environment = process.env) {
  const directory = mermaidOracleDirectory(environment);
  if (environment.TRIDENT_MERMAID_ORACLE === `${MERMAID_ORACLE_PIN.version} ${directory}` && existsSync(directory)) return { directory, version: MERMAID_ORACLE_PIN.version, parserVersion: MERMAID_ORACLE_PIN.parser, domVersion: MERMAID_ORACLE_PIN.dom, integrity: null };
  const oracle = admitMermaidOracle(directory, environment);
  environment.MERMAID_REFERENCE_DIR = directory;
  environment.TRIDENT_MERMAID_ORACLE = `${oracle.version} ${directory}`;
  return oracle;
}

// portable/ci-policy.ts
function assertBenchmarkExecutionAllowed(environment = process.env, requirements = {}) {
  const enabled = (value) => value !== void 0 && value !== "" && !/^(?:0|false|no)$/i.test(value);
  const indicators = ["CI", "GITHUB_ACTIONS", "GITLAB_CI", "BUILDKITE", "CIRCLECI", "TF_BUILD", "JENKINS_URL", "TEAMCITY_VERSION"];
  const active = indicators.filter((name) => enabled(environment[name]));
  if (active.length) throw new Error(`Benchmarks are excluded from CI (${active.join(", ")}). Run them in an explicit local measurement session; records can be updated without rerunning unchanged projects.`);
  if (requirements.mermaidOracle ?? true) assertMermaidOracle(environment);
}

// portable/worker.mjs
assertBenchmarkExecutionAllowed();
var transport = process.argv[2];
var job = transport === "--ipc" ? await new Promise((resolve2) => process.once("message", (message) => {
  if (message?.phase !== "job") throw Error("Invalid worker job message");
  resolve2(message.job);
})) : transport === "--stdio" ? JSON.parse(readFileSync2(0, "utf8")) : JSON.parse(readFileSync2(transport, "utf8"));
var started = process.hrtime.bigint();
var clock = () => Number(process.hrtime.bigint()) / 1e6;
var runtime = { executable: process.execPath, node: process.versions.node, platform: process.platform, arch: process.arch };
var result = { protocol: "portable-svg-processes-v3", caseId: job.testCase.id, family: job.testCase.family, mode: job.mode, round: job.round, replica: job.replica, sample: job.sample, status: "blocked", importMs: 0, tracks: {}, iterations: {}, outputBytes: 0, qualification: null, prelude: [], runtime };
var errorText = (error) => error instanceof Error ? String(error.stack ?? error) : String(error);
var thenable = (value) => value && typeof value.then === "function";
function collect() {
  if (global.gc) {
    global.gc();
    global.gc();
  }
}
try {
  const module = await import(pathToFileURL(job.artifact.entry).href);
  const api = module.default && typeof module.default === "object" ? { ...module.default, ...module } : module;
  const rendering = job.artifact.adapter === "agentic" ? api.renderMermaidSVG : job.artifact.adapter === "beautiful" ? api.renderMermaidSVG ?? api.renderMermaidSync ?? api.renderMermaid : api.render;
  if (typeof rendering !== "function") throw Error("Declared public SVG renderer is unavailable");
  result.importMs = Number(process.hrtime.bigint() - started) / 1e6;
  if (job.mode === "cold" && process.send) {
    process.send({ phase: "ready" });
    await new Promise((resolve2) => process.once("message", (message) => {
      if (message?.phase !== "start") throw Error("Invalid first-use barrier message");
      resolve2();
    }));
  }
  const invoke = async (source, options, recordWindow = false) => {
    let value, error, bytes = 0;
    const invocationOptions = options === void 0 ? void 0 : structuredClone(options);
    const begin = clock();
    const startNs = recordWindow ? process.hrtime.bigint().toString() : void 0;
    try {
      value = rendering(source, invocationOptions);
      if (thenable(value)) value = await value;
      const svg = typeof value === "string" ? value : value?.svg;
      if (typeof svg !== "string") throw Error("Public renderer did not return SVG text");
      bytes = Buffer.byteLength(svg, "utf8");
    } catch (caught) {
      error = errorText(caught);
    }
    const elapsedMs = clock() - begin;
    if (recordWindow) result.apiWindow = { startNs, endNs: process.hrtime.bigint().toString() };
    return { value, error, bytes, elapsedMs };
  };
  const testCase = job.testCase;
  const admitted = [];
  const inspect = async (rendered, expectedCase, source) => {
    const svg = typeof rendered.value === "string" ? rendered.value : rendered.value?.svg;
    const previous = typeof svg === "string" && admitted.find((item) => item.expected === expectedCase.expected && item.svg === svg);
    if (previous) return previous.qualification;
    let model;
    if (!rendered.error && typeof api.parse === "function") {
      try {
        model = api.parse(source);
        if (thenable(model)) model = await model;
      } catch {
      }
    }
    const qualification = qualifyPortable(expectedCase, { svg, model, error: rendered.error, adapter: job.artifact.adapter });
    if (qualification.checks.some((check) => check.status === "failed")) {
      result.status = "failed";
      result.error ??= "A consumed SVG return failed its declared checks";
      result.qualification = qualification;
    } else if (typeof svg === "string") {
      admitted.push({ expected: expectedCase.expected, svg, qualification });
      if (admitted.length > 4) admitted.shift();
    }
    return qualification;
  };
  for (const prelude of testCase.prelude ?? []) {
    const rendered = await invoke(prelude.source, void 0);
    const actualAccepted = !rendered.error;
    result.prelude.push({ source: prelude.source, expectedAccepted: prelude.accept, actualAccepted, passed: prelude.accept === actualAccepted });
  }
  let retained;
  if (job.mode === "probe") {
    const probe = await invoke(testCase.source, testCase.renderOptions);
    result.status = probe.error ? "unsupported" : "passed";
    result.outputBytes = probe.bytes;
    if (probe.error) result.error = probe.error;
  } else if (job.mode === "baseline") {
    collect();
    const before = process.memoryUsage();
    collect();
    result.memory = { before, atReturn: process.memoryUsage(), afterGc: process.memoryUsage(), gcAvailable: !!global.gc };
    result.status = "passed";
  } else if (job.mode === "memory") {
    collect();
    const before = process.memoryUsage();
    let memoryCall = await invoke(testCase.source, testCase.renderOptions);
    const atReturn = process.memoryUsage();
    result.outputBytes = memoryCall.bytes;
    if (!memoryCall.error !== testCase.expected.accept) {
      result.status = "failed";
      result.error = `Memory-measured invocation changed acceptance: ${memoryCall.error ?? "unexpected success"}`;
    }
    memoryCall.value = null;
    memoryCall = null;
    collect();
    result.memory = { before, atReturn, afterGc: process.memoryUsage(), gcAvailable: !!global.gc };
    retained = await invoke(testCase.source, testCase.renderOptions);
  } else if (job.mode === "retention") {
    collect();
    result.retention = [{ calls: 0, snapshot: process.memoryUsage() }];
    for (let count = 1; count <= 1e3; count++) {
      let rendered = await invoke(`${testCase.source}
%% retention-source-${count}`, testCase.renderOptions);
      if (!rendered.error !== testCase.expected.accept) {
        result.status = "failed";
        result.error ??= `Retention invocation${count} changed acceptance: ${rendered.error ?? "unexpected success"}`;
      }
      rendered.value = null;
      rendered = null;
      if ([10, 100, 1e3].includes(count)) {
        collect();
        result.retention.push({ calls: count, snapshot: process.memoryUsage() });
      }
    }
    retained = await invoke(testCase.source, testCase.renderOptions);
  } else if (job.mode === "cold") {
    retained = await invoke(testCase.source, testCase.renderOptions, true);
    result.tracks["first-use"] = [retained.elapsedMs];
  } else {
    retained = await invoke(testCase.source, testCase.renderOptions);
    await inspect(retained, testCase, testCase.source);
    for (const track of ["warm-repeat", "warm-new-source", ...testCase.edit ? ["warm-label-edit"] : []]) {
      const samples = [];
      const iterations = [];
      let lastSource = testCase.source;
      let invocation = 0;
      for (let index = 0; index < job.samples; index++) {
        let elapsed = 0, calls = 0;
        do {
          const edited2 = track === "warm-label-edit" && invocation % 2 === 1;
          const source = track === "warm-new-source" ? `${testCase.source}
%% portable-source-${job.round}-${invocation}` : edited2 ? testCase.edit.source : testCase.source;
          const options = edited2 ? testCase.edit.renderOptions ?? testCase.renderOptions : testCase.renderOptions;
          const current = await invoke(source, options);
          if (!current.error !== testCase.expected.accept) {
            result.status = "failed";
            result.error = "Acceptance changed during the measured track";
          }
          const expectedCase2 = edited2 ? { ...testCase, source, expected: testCase.edit.expected, renderOptions: testCase.edit.renderOptions ?? testCase.renderOptions } : { ...testCase, source };
          await inspect(current, expectedCase2, source);
          lastSource = source;
          elapsed += current.elapsedMs;
          calls++;
          invocation++;
          retained = current;
        } while (elapsed < (job.minSampleMs ?? 2) && calls < 256);
        samples.push(elapsed / calls);
        iterations.push(calls);
      }
      result.tracks[track] = samples;
      result.iterations[track] = iterations;
      const edited = track === "warm-label-edit" && (invocation - 1) % 2 === 1;
      const expectedCase = edited ? { ...testCase, source: lastSource, expected: testCase.edit.expected, renderOptions: testCase.edit.renderOptions ?? testCase.renderOptions } : { ...testCase, source: lastSource };
      const checked = await inspect(retained, expectedCase, expectedCase.source);
      if (checked.checks.some((check) => check.status === "failed")) {
        result.status = "failed";
        result.error = `${track}: declared output checks failed`;
        result.qualification = checked;
      }
    }
    if (testCase.edit) {
      const rendered = await invoke(testCase.edit.source, testCase.edit.renderOptions ?? testCase.renderOptions);
      let model;
      if (!rendered.error && typeof api.parse === "function") {
        try {
          model = api.parse(testCase.edit.source);
          if (thenable(model)) model = await model;
        } catch {
        }
      }
      const checked = qualifyPortable({ ...testCase, source: testCase.edit.source, expected: testCase.edit.expected, renderOptions: testCase.edit.renderOptions ?? testCase.renderOptions }, { svg: typeof rendered.value === "string" ? rendered.value : rendered.value?.svg, model, error: rendered.error, adapter: job.artifact.adapter });
      if (checked.checks.some((check) => check.status === "failed")) {
        result.status = "failed";
        result.error = "Edited output failed declared checks";
        result.qualification = checked;
      }
    }
    retained = await invoke(testCase.source, testCase.renderOptions);
  }
  if (retained) {
    if (retained.error) result.error ??= retained.error;
    if (job.mode !== "memory") result.outputBytes = retained.bytes;
    let model;
    if (!retained.error && typeof api.parse === "function") {
      try {
        model = api.parse(testCase.source);
        if (thenable(model)) model = await model;
      } catch {
      }
    }
    const svg = typeof retained.value === "string" ? retained.value : retained.value?.svg;
    const qualification = qualifyPortable(testCase, { svg, model, error: retained.error, adapter: job.artifact.adapter });
    result.qualification ??= qualification;
    if (result.status !== "failed") result.status = qualification.checks.some((check) => check.status === "failed") || !result.prelude.every((item) => item.passed) ? "failed" : qualification.passed ? "passed" : "partial";
    if (job.svgFile && typeof svg === "string") writeFileSync(job.svgFile, svg, { flag: "wx" });
  }
} catch (error) {
  result.status = "blocked";
  result.error = errorText(error);
}
if (result.prelude.some((item) => !item.passed)) {
  result.status = "failed";
  result.error ??= "A declared prelude changed acceptance";
}
if (result.qualification && !result.qualification.checks.some((check) => check.status === "failed") && !job.fullEvidence) {
  result.qualification.checks = result.qualification.checks.map((check) => ({ ...check, expected: null, actual: null }));
  result.qualification.unmeasuredScopes.push("Repeated passing check payloads omitted; authored expectations and representative SVG/model evidence are retained with the run. Failed checks retain their full payloads.");
}
process.exitCode = result.status === "blocked" ? 2 : 0;
if (transport === "--ipc") {
  process.send({ phase: "result", result }, (error) => {
    if (error) process.exitCode = 1;
    if (process.connected) process.disconnect();
  });
} else if (transport === "--stdio") writeFileSync(3, JSON.stringify(result) + "\n");
else writeFileSync(job.resultFile, JSON.stringify(result) + "\n", { flag: "wx" });
/*! Bundled license information:

xmlchars/xml/1.0/ed5.js:
  (**
   * Character classes and associated utilities for the 5th edition of XML 1.0.
   *
   * @author Louis-Dominique Dubeau
   * @license MIT
   * @copyright Louis-Dominique Dubeau
   *)

xmlchars/xml/1.1/ed2.js:
  (**
   * Character classes and associated utilities for the 2nd edition of XML 1.1.
   *
   * @author Louis-Dominique Dubeau
   * @license MIT
   * @copyright Louis-Dominique Dubeau
   *)

xmlchars/xmlns/1.0/ed3.js:
  (**
   * Character class utilities for XML NS 1.0 edition 3.
   *
   * @author Louis-Dominique Dubeau
   * @license MIT
   * @copyright Louis-Dominique Dubeau
   *)
*/
