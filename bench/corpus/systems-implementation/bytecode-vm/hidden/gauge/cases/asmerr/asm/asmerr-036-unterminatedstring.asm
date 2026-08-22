; case asmerr-036-unterminatedstring
; expect exit=2 stdout=""
; expect error=E_ASM
.func main arity=0 locals=0
  PUSH_STR "abc
  RET
.end
