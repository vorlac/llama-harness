; case strops-007-concat
; expect exit=0 stdout="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy\n"
.func main arity=0 locals=0
  PUSH_STR "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
  PUSH_STR "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"
  CONCAT
  PRINT
  RET
.end
