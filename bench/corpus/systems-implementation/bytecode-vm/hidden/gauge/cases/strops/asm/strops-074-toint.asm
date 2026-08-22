; case strops-074-toint
; expect exit=0 stdout="42\n"
.func main arity=0 locals=0
  PUSH_STR "00042"
  TOINT
  PRINT
  RET
.end
