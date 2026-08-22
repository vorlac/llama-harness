; case arith-015-add
; expect exit=0 stdout="1111111110\n"
.func main arity=0 locals=0
  PUSH_INT 123456789
  PUSH_INT 987654321
  ADD
  PRINT
  RET
.end
