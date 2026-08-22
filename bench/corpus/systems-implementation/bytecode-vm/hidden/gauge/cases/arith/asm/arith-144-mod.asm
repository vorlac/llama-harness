; case arith-144-mod
; expect exit=0 stdout="0\n"
.func main arity=0 locals=0
  PUSH_INT -4294967296
  PUSH_INT 65536
  MOD
  PRINT
  RET
.end
