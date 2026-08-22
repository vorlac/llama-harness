; case strops-078-toint
; expect exit=0 stdout="-123\n"
.func main arity=0 locals=0
  PUSH_STR "-000123"
  TOINT
  PRINT
  RET
.end
