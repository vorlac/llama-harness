; case bitwise-073-shr
; expect exit=0 stdout="4611686018427387903\n"
.func main arity=0 locals=0
  PUSH_INT 9223372036854775807
  PUSH_INT 1
  SHR
  PRINT
  RET
.end
