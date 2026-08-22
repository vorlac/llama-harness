; case strops-094-tointbool
; expect exit=0 stdout="1\n"
.func main arity=0 locals=0
  PUSH_TRUE
  TOINT
  PRINT
  RET
.end
