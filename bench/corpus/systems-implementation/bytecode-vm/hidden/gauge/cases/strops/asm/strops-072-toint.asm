; case strops-072-toint
; expect exit=0 stdout="-1\n"
.func main arity=0 locals=0
  PUSH_STR "-1"
  TOINT
  PRINT
  RET
.end
