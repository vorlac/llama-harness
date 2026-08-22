; case strops-077-toint
; expect exit=0 stdout="-9223372036854775808\n"
.func main arity=0 locals=0
  PUSH_STR "-9223372036854775808"
  TOINT
  PRINT
  RET
.end
