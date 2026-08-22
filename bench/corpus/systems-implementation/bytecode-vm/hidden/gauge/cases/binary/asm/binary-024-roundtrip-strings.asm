; case binary-024-roundtrip-strings
; expect exit=0 stdout=""
.func main arity=0 locals=0
  PUSH_STR "tab\tnl\nquote\"back\\end"
  PRINT
  PUSH_STR ""
  PRINT
  RET
.end
