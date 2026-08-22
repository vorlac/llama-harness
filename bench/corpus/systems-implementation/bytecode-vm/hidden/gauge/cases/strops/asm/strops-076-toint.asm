; case strops-076-toint
; expect exit=0 stdout="9223372036854775807\n"
.func main arity=0 locals=0
  PUSH_STR "9223372036854775807"
  TOINT
  PRINT
  RET
.end
