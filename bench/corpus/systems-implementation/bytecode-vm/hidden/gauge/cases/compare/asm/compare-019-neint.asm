; case compare-019-neint
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_INT 9223372036854775807
  PUSH_INT -9223372036854775808
  NE
  PRINT
  RET
.end
