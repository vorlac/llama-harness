; case strops-095-tointbool
; expect exit=0 stdout="0\n"
.func main arity=0 locals=0
  PUSH_FALSE
  TOINT
  PRINT
  RET
.end
