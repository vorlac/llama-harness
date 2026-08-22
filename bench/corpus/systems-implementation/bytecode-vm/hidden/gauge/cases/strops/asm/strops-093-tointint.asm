; case strops-093-tointint
; expect exit=0 stdout="-5\n"
.func main arity=0 locals=0
  PUSH_INT -5
  TOINT
  PRINT
  RET
.end
