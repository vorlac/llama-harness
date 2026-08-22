; case strops-075-toint
; expect exit=0 stdout="0\n"
.func main arity=0 locals=0
  PUSH_STR "-0"
  TOINT
  PRINT
  RET
.end
